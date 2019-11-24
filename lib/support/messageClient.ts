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
    Destination,
    EventIncoming,
    logger,
    MessageOptions,
} from "@atomist/automation-client";
import { AbstractMessageClient } from "@atomist/automation-client/lib/internal/transport/websocket/WebSocketMessageClient";
import { Source } from "@atomist/automation-client/src/lib/internal/transport/RequestProcessor";
import { SlackMessage } from "@atomist/slack-messages";
import { PubSub } from "@google-cloud/pubsub";

export interface PubSubPublisher {
    publish(message: any): Promise<void>;
}

abstract class AbstractPubSubMessageClient extends AbstractMessageClient implements PubSubPublisher {

    private readonly pubsub: PubSub;

    constructor(protected readonly request: CommandIncoming | EventIncoming,
                protected readonly correlationId: string,
                protected readonly team: { id: string, name?: string },
                protected readonly source: Source,
                protected readonly configuration: Configuration) {
        super(request, correlationId, team, source, configuration);
        this.pubsub = new PubSub();

    }

    public async publish(message: any): Promise<void> {
        return this.sendResponse(message);
    }

    public async sendResponse(message: any): Promise<void> {
        const topic = this.pubsub.topic(process.env.TOPIC);
        const messageObject = {
            data: {
                message,
            },
        };
        const messageBuffer = Buffer.from(JSON.stringify(messageObject), "utf8");
        try {
            await topic.publish(messageBuffer);
        } catch (err) {
            logger.error(`Error occurred sending message: ${err.message}`);
        }
    }
}

export class PubSubCommandMessageClient extends AbstractPubSubMessageClient {

    constructor(protected readonly request: CommandIncoming,
                protected readonly configuration: Configuration) {
        super(request, request.correlation_id, request.team, request.source, configuration);
    }

    protected async doSend(msg: string | SlackMessage,
                           destinations: Destination | Destination[],
                           options: MessageOptions = {}): Promise<any> {
        return super.doSend(msg, destinations, options);
    }
}

export class PubSubEventMessageClient extends AbstractPubSubMessageClient {

    constructor(protected readonly request: EventIncoming,
                protected readonly configuration: Configuration) {
        super(request, request.extensions.correlation_id,
            { id: request.extensions.team_id, name: request.extensions.team_name }, null, configuration);
    }

    protected async doSend(msg: string | SlackMessage,
                           destinations: Destination | Destination[],
                           options: MessageOptions = {}): Promise<any> {
        const destinationsArray = !Array.isArray(destinations) ? [destinations] : destinations;
        if (destinationsArray.length === 0) {
            throw new Error("Response messages are not supported for event handlers");
        } else {
            return super.doSend(msg, destinationsArray, options);
        }
    }
}
