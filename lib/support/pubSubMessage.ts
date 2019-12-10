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
    guid,
    HandlerContext,
    QueryNoCacheOptions,
} from "@atomist/automation-client";
import { spawnPromise } from "@atomist/automation-client/lib/util/child_process";
import {
    formatDate,
    SdmGoalState,
    updateGoal,
} from "@atomist/sdm";
import { DashboardDisplayProgressLog } from "@atomist/sdm-core/lib/log/DashboardDisplayProgressLog";
import { SdmGoalsByGoalSetIdAndUniqueName } from "../typings/types";
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
        correlationId: result?.id,
        context: {
            correlationId: result.id,
            invocationId: guid(),
            name: configuration.name,
            version: configuration.version,
            operation: "CloudBuildEvent",
            workspaceId: result?.substitutions?._ATOMIST_WORKSPACE_ID,
            workspaceName: result?.substitutions?._ATOMIST_WORKSPACE_ID,
            ts: Date.now(),
        },
    } as any;

    const goal = await graphClient.query<SdmGoalsByGoalSetIdAndUniqueName.Query, SdmGoalsByGoalSetIdAndUniqueName.Variables>({
        name: "SdmGoalsByGoalSetIdAndUniqueName",
        variables: {
            goalSetId: [result?.substitutions._ATOMIST_GOAL_SET_ID],
            uniqueName: [result?.substitutions._ATOMIST_GOAL_NAME],
        },
        options: QueryNoCacheOptions,
    });

    if (!!goal?.SdmGoal && !!goal?.SdmGoal[0]) {

        const goalEvent = goal.SdmGoal[0];
        const id = result.id;
        const progressLog = new DashboardDisplayProgressLog(configuration, context, goalEvent as any);

        try {
            const logResult = await spawnPromise("gcloud", ["builds", "log", id]);
            const log = logResult.stdout.split("\n");
            for (const l of log) {
                progressLog.write(l);
            }
            await progressLog.flush();
        } catch (e) {

        }

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

        await updateGoal(context, goalEvent as any, {
            state,
            description,
        });

        if (state !== SdmGoalState.in_process) {
            progressLog.write(`/--`);
            progressLog.write(`Finish: ${formatDate(new Date(), "yyyy-mm-dd HH:MM:ss.l")}`);
            progressLog.write("\\--");
            await progressLog.close();
        }
    }
}
