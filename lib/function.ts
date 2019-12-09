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
import {
    configureYaml,
    githubGoalStatusSupport,
} from "@atomist/sdm-core";
import { gcpSupport } from "@atomist/sdm-pack-gcp";
import * as _ from "lodash";
import * as path from "path";
// tslint:disable-next-line:no-import-side-effect
import "source-map-support/register";
import { RequestProcessMaker } from "./support/requestProcessor";

interface PubSubMessage {
    data: string;
}

const ProjectLoader = new CachingProjectLoader();

export const sdm = async (pubSubEvent: PubSubMessage) => {
    const payload: CommandIncoming | EventIncoming =
        JSON.parse(Buffer.from(pubSubEvent.data, "base64").toString());

    const cfg = await prepareConfiguration(payload);
    const client = automationClient(cfg, RequestProcessMaker);
    (client as any).defaultListeners.splice(1);
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

export const eventhandler = sdm;

async function prepareConfiguration(event: CommandIncoming | EventIncoming): Promise<Configuration> {
    const baseCfg = await configureYaml(
        "*.yaml",
        { cwd: path.resolve(__dirname, "..", "..", "..", "..") });

    let workspaceId;
    if (isCommandIncoming(event)) {
        workspaceId = event.team.id;
    } else if (isEventIncoming(event)) {
        workspaceId = event.extensions.team_id;
    }

    // For now, let's set the storage bucket
    process.env.STORAGE = `gs://workspace-storage-${workspaceId.toLowerCase()}`;

    const bucket = process.env.STORAGE?.replace(/gs:\/\//g, "");

    _.set(baseCfg, "http.enabled", false);
    _.set(baseCfg, "ws.enabled", false);
    _.set(baseCfg, "logging.level", "debug");
    _.set(baseCfg, "logging.color", false);
    _.set(baseCfg, "cluster.enabled", false);

    _.set(baseCfg, "sdm.extensionPacks", [
        githubGoalStatusSupport(),
        ...(!!bucket ? [gcpSupport()] : []),
    ]);
    _.set(baseCfg, "sdm.projectLoader", ProjectLoader);
    _.set(baseCfg, "sdm.goal.timeout", 1200000);
    _.set(baseCfg, "sdm.cache", {
        enabled: true,
        bucket,
        path: !bucket ? "/tmp/sdm" : undefined,
    });

    const apiKeySecret = event.secrets.find(s => s.uri === "atomist://api-key");
    baseCfg.apiKey = apiKeySecret?.value;
    baseCfg.workspaceIds = [workspaceId];

    return loadConfiguration(Promise.resolve(baseCfg));
}
