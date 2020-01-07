import { Configuration } from "@atomist/automation-client/lib/configuration";
import {
    CommandIncoming,
    EventIncoming,
    isCommandIncoming,
    isEventIncoming,
} from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import {
    clientFormat,
    logger,
} from "@atomist/automation-client/lib/util/logger";
import { redactLog } from "@atomist/automation-client/lib/util/redact";
import { DashboardDisplayProgressLog } from "@atomist/sdm-core/lib/log/DashboardDisplayProgressLog";
import { SdmGoalEvent } from "@atomist/sdm/lib/api/goal/SdmGoalEvent";
import { ProgressLog } from "@atomist/sdm/lib/spi/log/ProgressLog";
import * as winston from "winston";
import * as Transport from "winston-transport";
import { MESSAGE } from "triple-beam";

class RolarTransport extends Transport {

    private logInstance: ProgressLog;
    private messages = [];

    public format = winston.format.combine(
       winston.format(redactLog)(),
        winston.format.timestamp(),
        winston.format.splat(),
        winston.format.printf(clientFormat),
        winston.format.uncolorize(),
    );

    public async start(payload: CommandIncoming | EventIncoming, configuration: Configuration): Promise<void> {
        let workspaceId;
        let correlationId;
        let operation;
        let type;

        if (isCommandIncoming(payload)) {
            workspaceId = payload.team.id;
            correlationId = payload.correlation_id;
            operation = payload.command;
            type = "command";
        } else if (isEventIncoming(payload)) {
            workspaceId = payload.extensions.team_id;
            correlationId = payload.extensions.correlation_id;
            operation = payload.extensions.operationName;
            type = "event";
        }

        const repoParts = configuration.name.split("/");
        const goal: SdmGoalEvent = {
            repo: {
                owner: repoParts[0],
                name: repoParts[1],
            },
            sha: configuration.version,
            environment: type,
            uniqueName: operation,
            goalSetId: correlationId,
        } as any;

        this.logInstance = new DashboardDisplayProgressLog(configuration, { workspaceId, correlationId } as any, goal);
        logger.info(`Execution log at '${this.logInstance.url}'`);
    }

    public async stop(): Promise<void> {
        await this.logInstance.flush();
        clearInterval((this.logInstance as any).timer);
        this.logInstance = undefined;
    }

    public log(info, callback) {
        setImmediate(() => this.emit("logged", info));
        if (!!this.logInstance) {
            if (this.messages.length > 0) {
                 this.logInstance.write(this.messages.join("\n"));
                 this.messages = [];
            }
            this.logInstance.write(info[MESSAGE]);
        } else {
            this.messages.push(info[MESSAGE]);
        }
        callback();
    }
}

export const SkillTransport = new RolarTransport();
