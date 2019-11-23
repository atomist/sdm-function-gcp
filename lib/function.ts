/*
 * Copyright © 2019 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    CommandIncoming,
    Configuration,
    EventIncoming,
    logger,
} from "@atomist/automation-client";
import { automationClient } from "@atomist/automation-client/lib/automationClient";
import { loadConfiguration } from "@atomist/automation-client/lib/configuration";
import {
    isCommandIncoming,
    isEventIncoming,
} from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { CachingProjectLoader } from "@atomist/sdm";
import { configureYaml } from "@atomist/sdm-core";
import * as _ from "lodash";
import * as path from "path";
import { RequestProcessMaker } from "./support/requestProcessor";

interface PubSubMessage { message: { data: string }; }

const ProjectLoader = new CachingProjectLoader();

export const sdm = async (pubSubEvent: PubSubMessage, context: any) => {
    const payload: CommandIncoming | EventIncoming =
        JSON.parse(Buffer.from(pubSubEvent.message.data, "base64").toString());

    const cfg = await prepareConfiguration(payload);
    const client = automationClient(cfg, RequestProcessMaker);
    await client.run();

    if (isCommandIncoming(payload)) {
        try {
            await new Promise<void>((resolve, reject) => {
                client.processCommand(payload, pResults => {
                    pResults.then(results => {
                        logger.debug("Processing command completed with results %j", results);
                        resolve();
                    }, reject);
                });
            });
        } catch (e) {
            logger.error(`Processing command failed: ${e.message}`);
        }
    } else if (isEventIncoming(payload)) {
        try {
            await new Promise<void>((resolve, reject) => {
                client.processEvent(payload, pResults => {
                    pResults.then(results => {
                        logger.debug("Processing event completed with results %j", results);
                        resolve();
                    }, reject);
                });
            });
        } catch (e) {
            logger.error(`Processing event failed: ${e.message}`);
        }
    }
};

async function prepareConfiguration(event: CommandIncoming | EventIncoming): Promise<Configuration> {
    const baseCfg = await configureYaml(
        "*.yaml",
        { cwd: path.resolve(__dirname, "..", "..", "..", "..") });

    _.set(baseCfg, "http.enabled", false);
    _.set(baseCfg, "ws.enabled", false);
    _.set(baseCfg, "sdm.extensionPacks", []);
    _.set(baseCfg, "sdm.projectLoader", ProjectLoader);

    const apiKeySecret = event.secrets.find(s => s.uri === "atomist://apiKey");
    baseCfg.apiKey = apiKeySecret?.value;
    baseCfg.groups = ["function"];

    return loadConfiguration(Promise.resolve(baseCfg));
}
