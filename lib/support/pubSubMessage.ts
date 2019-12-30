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
    AutomationContextAware,
    HandlerContext,
} from "@atomist/automation-client/lib/HandlerContext";
import { guid } from "@atomist/automation-client/lib/internal/util/string";
import { QueryNoCacheOptions } from "@atomist/automation-client/lib/spi/graph/GraphClient";
import { spawnPromise } from "@atomist/automation-client/lib/util/child_process";
import { logger } from "@atomist/automation-client/lib/util/logger";
import { rolarAndDashboardLogFactory } from "@atomist/sdm-core/lib/log/rolarAndDashboardLogFactory";
import { updateGoal } from "@atomist/sdm/lib/api-helper/goal/storeGoals";
import { LoggingProgressLog } from "@atomist/sdm/lib/api-helper/log/LoggingProgressLog";
import { WriteToAllProgressLog } from "@atomist/sdm/lib/api-helper/log/WriteToAllProgressLog";
import { formatDate } from "@atomist/sdm/lib/api-helper/misc/dateFormat";
import { SdmGoalEvent } from "@atomist/sdm/lib/api/goal/SdmGoalEvent";
import {
    SdmGoalsByGoalSetIdAndUniqueName,
    SdmGoalState,
} from "../typings/types";
import { prepareConfiguration } from "./configuration";
import { PubSubEventMessageClient } from "./messageClient";

export async function handlePubSubMessage(payload: any): Promise<void> {
    // Handle Cloud Build message
    if (payload?.steps && payload?.substitutions && payload?.id) {
        return handleCloudBuildPubSubMessage(payload);
    }
}

interface CloudBuildPubSubMessage {
    id: string;
    status: "QUEUED" | "SUCCESS" | "WORKING" | "CANCELLED";
    substitutions: {
        _ATOMIST_API_KEY: string;
        _ATOMIST_GOAL_NAME: string;
        _ATOMIST_GOAL_SET_ID: string;
        _ATOMIST_WORKSPACE_ID: string;
    };
}

async function handleCloudBuildPubSubMessage(result: CloudBuildPubSubMessage): Promise<void> {
    const configuration = await prepareConfiguration(result?.substitutions?._ATOMIST_WORKSPACE_ID, result?.substitutions?._ATOMIST_API_KEY);

    const graphClient = configuration.graphql.client.factory.create(result?.substitutions._ATOMIST_WORKSPACE_ID, configuration);

    const goal = await graphClient.query<SdmGoalsByGoalSetIdAndUniqueName.Query, SdmGoalsByGoalSetIdAndUniqueName.Variables>({
        name: "SdmGoalsByGoalSetIdAndUniqueName",
        variables: {
            goalSetId: [result?.substitutions._ATOMIST_GOAL_SET_ID],
            uniqueName: [result?.substitutions._ATOMIST_GOAL_NAME],
        },
        options: QueryNoCacheOptions,
    });

    if (!!goal?.SdmGoal && !!goal?.SdmGoal[0]) {

        const goalEvent: SdmGoalEvent = goal.SdmGoal[0] as any;
        const correlationId = goalEvent.provenance.find(p => p.name === "FulfillGoalOnRequested").correlationId;

        const context: HandlerContext & AutomationContextAware = {
            graphClient,
            messageClient: new PubSubEventMessageClient({
                extensions: {
                    correlation_id: result.id,
                    team_id: result?.substitutions?._ATOMIST_WORKSPACE_ID,
                    team_name: result?.substitutions?._ATOMIST_WORKSPACE_ID,
                },
            } as any, configuration),
            workspaceId: result?.substitutions?._ATOMIST_WORKSPACE_ID,
            correlationId,
            context: {
                correlationId,
                invocationId: guid(),
                name: configuration.name,
                version: configuration.version,
                operation: "CloudBuildEvent",
                workspaceId: result?.substitutions?._ATOMIST_WORKSPACE_ID,
                workspaceName: result?.substitutions?._ATOMIST_WORKSPACE_ID,
                ts: Date.now(),
            },
        } as any;

        const id = result.id;

        let state: SdmGoalState;
        let description: string;
        switch (result.status) {
            case "QUEUED":
            case "WORKING":
                state = SdmGoalState.in_process;
                description = goalEvent.descriptions?.inProcess;
                break;
            case "SUCCESS":
                state = SdmGoalState.success;
                description = goalEvent.descriptions?.completed;
                break;
            case "CANCELLED":
                state = SdmGoalState.canceled;
                description = goalEvent.descriptions?.canceled;
                break;
            default:
                state = SdmGoalState.failure;
                description = goalEvent.descriptions?.failed;
                break;
        }

        if (state !== SdmGoalState.in_process) {
            const progressLog = new WriteToAllProgressLog(
                goalEvent.name,
                new LoggingProgressLog(goalEvent.name, "debug"),
                await rolarAndDashboardLogFactory(context)(context, goalEvent));

            try {
                const logResult = await spawnPromise("gcloud", ["builds", "log", id]);
                const lines = logResult.stdout.split("\n");
                for (const line of lines) {
                    if (/^Step #[1-9]*:.*$/.test(line)) {
                        progressLog.write(line.replace(/Step #[1-9]*:/, ""));
                    }
                }
                await progressLog.flush();
            } catch (e) {
                logger.warn(`Error retrieving gcloud build logs: ${e.message}`);
            }

            progressLog.write(`/--`);
            progressLog.write(`Finish: ${formatDate(new Date(), "yyyy-mm-dd HH:MM:ss.l")}`);
            progressLog.write("\\--");
            await progressLog.close();
        }

        logger.info(`Updating goal '${goalEvent.uniqueName}' with state '${state}'`);

        await updateGoal(context, goalEvent as any, {
            state,
            description,
        });

    }
}
