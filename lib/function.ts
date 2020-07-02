/*
 * Copyright © 2020 Atomist, Inc.
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

// tslint:disable-next-line:no-import-side-effect
import "source-map-support/register";

import {
    automationClient,
    AutomationClient,
} from "@atomist/automation-client/lib/automationClient";
import { automationClientInstance } from "@atomist/automation-client/lib/globals";
import {
    CommandIncoming,
    EventIncoming,
    isCommandIncoming,
    isEventIncoming,
} from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { replacer } from "@atomist/automation-client/lib/internal/util/string";
import {
    configureLogging,
    logger,
} from "@atomist/automation-client/lib/util/logger";
import { prepareConfiguration } from "./support/configuration";
import { ConsoleTransport } from "./support/logging";

export interface PubSubMessage {
    data: string;
    attributes: any;
}

export const entryPoint = async (pubSubEvent: PubSubMessage, context: any, options: any) => {
    const attributes = {
        ...(pubSubEvent.attributes || {}),
        eventId: context.eventId,
    };
    console.log(`atm:attributes=${JSON.stringify(attributes)}`);

    const payload: CommandIncoming | EventIncoming =
        JSON.parse(Buffer.from(pubSubEvent.data, "base64").toString());

    let client: AutomationClient = automationClientInstance();

    if (!client) {
        configureLogging({
            console: {
                redirect: false,
                enabled: false,
            },
            file: {
                enabled: false,
            },
            redact: true,
            callsites: false,
            color: false,
            custom: [new ConsoleTransport()],
        });
    }

    logger.info(`Incoming pub/sub message: ${JSON.stringify(payload, replacer)}`);

    const apiKey = payload?.secrets?.find(s => s.uri === "atomist://api-key");

    let workspaceId;
    if (isCommandIncoming(payload)) {
        workspaceId = payload.team.id;
    } else if (isEventIncoming(payload)) {
        workspaceId = payload.extensions.team_id;
    }

    if (!client) {
        logger.info(`Starting new cold automation client`);
        const cfg = await prepareConfiguration(workspaceId, apiKey?.value, options);
        client = automationClient(cfg);
        (client as any).defaultListeners.splice(1);
        await client.run();
    } else {
        logger.info(`Re-using hot automation client`);
        client.automations.opts.apiKey = apiKey?.value;
    }

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

export const sdm = async (pubSubEvent: PubSubMessage, context: any) => {
    return entryPoint(pubSubEvent, context, {});
};

export const eventhandler = sdm;
