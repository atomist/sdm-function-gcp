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

import {
    Configuration,
    loadConfiguration,
} from "@atomist/automation-client/lib/configuration";
import { CompressionMethod } from "@atomist/sdm-core/lib/goal/cache/CompressingGoalCache";
import {
    CommandMaker,
    ConfigurationMaker,
    configureYaml,
    EventMaker,
} from "@atomist/sdm-core/lib/machine/yaml/configureYaml";
import { GoalMaker } from "@atomist/sdm-core/lib/machine/yaml/mapGoals";
import { PushTestMaker } from "@atomist/sdm-core/lib/machine/yaml/mapPushTests";
import { gcpSupport } from "@atomist/sdm-pack-gcp/lib/gcp";
import { CachingProjectLoader } from "@atomist/sdm/lib/api-helper/project/CachingProjectLoader";
import { GitHubLazyProjectLoader } from "@atomist/sdm/lib/api-helper/project/GitHubLazyProjectLoader";
import * as findUp from "find-up";
import * as _ from "lodash";
import * as path from "path";
import { RequestProcessMaker } from "./requestProcessor";

const ProjectLoader = new GitHubLazyProjectLoader(new CachingProjectLoader());

export async function prepareConfiguration(workspaceId: string,
                                           apiKey: string,
                                           options?: {
                                               commands?: Record<string, CommandMaker>,
                                               events?: Record<string, EventMaker>,
                                               goals?: Record<string, GoalMaker>,
                                               tests?: Record<string, PushTestMaker>,
                                               configurations?: Record<string, ConfigurationMaker>,
                                           }): Promise<Configuration> {
    const cwd = findUp.sync(["atomist.yaml", "atomist.yml"] as any, { cwd: __dirname, type: "file" });

    const baseCfg = await configureYaml<any>(
        "atomist.{yml,yaml}",
        {
            cwd: path.dirname(cwd),
            makers: {
                commands: options?.commands,
                events: options?.events,
                goals: options?.goals,
                tests: options?.tests,
                configurations: options?.configurations,
            },
            patterns: {
                commands: !!options?.commands ? [] : undefined,
                events: !!options?.events ? [] : undefined,
                goals: !!options?.goals ? [] : undefined,
                tests: !!options?.goals ? [] : undefined,
                configurations: !!options?.configurations ? [] : undefined,
            },
        });

    const bucket = process.env.STORAGE?.toLowerCase().replace(/gs:\/\//g, "");
    const graphqlEndpoint = process.env.GRAPHQL_ENDPOINT;

    _.set(baseCfg, "http.enabled", false);
    _.set(baseCfg, "ws.enabled", false);
    _.set(baseCfg, "logging.level", "debug");
    _.set(baseCfg, "logging.color", false);
    // _.set(baseCfg, "logging.custom.transports", [SkillTransport]);
    _.set(baseCfg, "cluster.enabled", false);
    _.set(baseCfg, "applicationEvents.enabled", false);

    _.set(baseCfg, "sdm.extensionPacks", [
        ...(!!bucket ? [gcpSupport({ compression: CompressionMethod.ZIP })] : []),
    ]);
    _.set(baseCfg, "sdm.projectLoader", ProjectLoader);
    _.set(baseCfg, "sdm.goal.timeout", 1200000);
    _.set(baseCfg, "sdm.cache", {
        enabled: true,
        bucket,
        path: !bucket ? "/tmp/sdm" : undefined,
    });

    baseCfg.apiKey = apiKey;
    baseCfg.workspaceIds = [workspaceId];
    baseCfg.policy = "ephemeral";
    baseCfg.requestProcessorFactory = RequestProcessMaker;

    if (!!graphqlEndpoint) {
        _.set(baseCfg, "endpoints.graphql", `${graphqlEndpoint}/team`);
    }

    return loadConfiguration(Promise.resolve(baseCfg));
}
