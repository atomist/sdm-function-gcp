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

    public async sendResponse(response: any): Promise<void> {
        const topic = this.pubsub.topic(process.env.TOPIC);
        const messageObject = {
            data: {
                message: response,
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
