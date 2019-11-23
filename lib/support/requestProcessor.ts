import {
    AutomationContextAware,
    AutomationEventListener,
    CommandIncoming,
    Configuration,
    EventIncoming,
    GraphClient,
    GraphClientFactory,
    HandlerContext,
    MessageClient,
} from "@atomist/automation-client";
import { AbstractRequestProcessor } from "@atomist/automation-client/lib/internal/transport/AbstractRequestProcessor";
import {
    isCommandIncoming,
    isEventIncoming,
    workspaceId,
} from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { AutomationServer } from "@atomist/automation-client/lib/server/AutomationServer";
import {
    PubSubCommandMessageClient,
    PubSubEventMessageClient,
    PubSubPublisher,
} from "./messageClient";

export const RequestProcessMaker = (automations, configuration, listeners) =>
    new PubSubRequestProcessor(automations, configuration, listeners);

class PubSubRequestProcessor extends AbstractRequestProcessor {

    private graphClients: GraphClientFactory;
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
        return this.publisher.publish(payload);
    }

}
