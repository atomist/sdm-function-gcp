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

import { Configuration } from "@atomist/automation-client/lib/configuration";
import {
    AutomationContextAware,
    HandlerContext,
} from "@atomist/automation-client/lib/HandlerContext";
import { AbstractRequestProcessor } from "@atomist/automation-client/lib/internal/transport/AbstractRequestProcessor";
import {
    CommandIncoming,
    EventIncoming,
    isCommandIncoming,
    isEventIncoming,
    workspaceId,
} from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { HandlerResponse } from "@atomist/automation-client/lib/internal/transport/websocket/WebSocketMessageClient";
import { AutomationEventListener } from "@atomist/automation-client/lib/server/AutomationEventListener";
import { AutomationServer } from "@atomist/automation-client/lib/server/AutomationServer";
import { GraphClient } from "@atomist/automation-client/lib/spi/graph/GraphClient";
import { GraphClientFactory } from "@atomist/automation-client/lib/spi/graph/GraphClientFactory";
import { MessageClient } from "@atomist/automation-client/lib/spi/message/MessageClient";
import {
    PubSubCommandMessageClient,
    PubSubEventMessageClient,
    PubSubPublisher,
} from "./messageClient";

export const RequestProcessMaker = (automations, configuration, listeners) =>
    new PubSubRequestProcessor(automations, configuration, listeners);

class PubSubRequestProcessor extends AbstractRequestProcessor {

    private readonly graphClients: GraphClientFactory;
    private publisher: PubSubPublisher & MessageClient;

    constructor(protected automations: AutomationServer,
                protected configuration: Configuration,
                protected listeners: AutomationEventListener[] = []) {
        super(automations, configuration, listeners);
        this.graphClients = configuration.graphql.client.factory;
    }

    protected createGraphClient(event: CommandIncoming | EventIncoming): GraphClient {
        return this.graphClients.create(
            workspaceId(event),
            this.configuration);
    }

    protected createMessageClient(event: EventIncoming | CommandIncoming, context: AutomationContextAware): MessageClient {
        if (isCommandIncoming(event)) {
            this.publisher = new PubSubCommandMessageClient(event, this.configuration);
        } else if (isEventIncoming(event)) {
            this.publisher = new PubSubEventMessageClient(event, this.configuration);
        }
        return this.publisher;
    }

    protected sendStatusMessage(payload: any, ctx: HandlerContext & AutomationContextAware): Promise<any> {
        const response = payload as HandlerResponse;
        if (!!response?.status) {
            const status = response.status;
            if (!status.hasOwnProperty("visibility")) {
                (status as any).visibility = "hidden";
            }
        }
        return this.publisher.publish(response);
    }

}
