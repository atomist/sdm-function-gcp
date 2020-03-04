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
import { SdmGoalEvent } from "@atomist/sdm/lib/api/goal/SdmGoalEvent";
import { DashboardDisplayProgressLog } from "@atomist/sdm/lib/core/log/DashboardDisplayProgressLog";
import { ProgressLog } from "@atomist/sdm/lib/spi/log/ProgressLog";
import {
    LEVEL,
    MESSAGE,
} from "triple-beam";
import * as winston from "winston";
import * as Transport from "winston-transport";

export class ConsoleTransport extends Transport {

    public level = "debug";

    public format: any = winston.format.combine(
        winston.format(redactLog)(),
        winston.format.timestamp(),
        winston.format.splat(),
        winston.format.printf(clientFormat),
        winston.format.uncolorize(),
    );

    public log(info: any, callback: () => void): void {
        setImmediate(() => this.emit("logged", info));

        const level = info[LEVEL];
        const msg = info[MESSAGE];

        switch (level) {
            case "error":
                console.error(msg);
                break;
            case "warn":
                console.warn(msg);
                break;
            default:
                console.log(msg);
                break;
        }

        if (callback) {
            callback();
        }
    }
}

class RolarTransport extends Transport {

    private logInstance: ProgressLog;
    private messages: string[] = [];

    public format: any = winston.format.combine(
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

    public log(info: any, callback: () => void): void {
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
