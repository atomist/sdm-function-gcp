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
import { CachingProjectLoader } from "@atomist/sdm/lib/api-helper/project/CachingProjectLoader";
import { GitHubLazyProjectLoader } from "@atomist/sdm/lib/api-helper/project/GitHubLazyProjectLoader";
import { CompressionMethod } from "@atomist/sdm/lib/core/goal/cache/CompressingGoalCache";
import {
    CommandMaker,
    ConfigurationMaker,
    configureYaml,
    EventMaker,
    Target,
} from "@atomist/sdm/lib/core/machine/yaml/configureYaml";
import { GoalMaker } from "@atomist/sdm/lib/core/machine/yaml/mapGoals";
import { PushTestMaker } from "@atomist/sdm/lib/core/machine/yaml/mapPushTests";
import { gcpSupport } from "@atomist/sdm/lib/pack/gcp";
import { githubGoalStatusSupport } from "@atomist/sdm/lib/pack/github-goal-status";
import { goalStateSupport } from "@atomist/sdm/lib/pack/goal-state";
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
    const cwd = findUp.sync("atomist.yaml", { cwd: __dirname, type: "file" });

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
            target: Target.Skill,
        });

    const bucket = process.env.STORAGE?.toLowerCase().replace(/gs:\/\//g, "");
    const graphqlEndpoint = process.env.GRAPHQL_ENDPOINT;
    const dashboardUrl = process.env.DASHBOARD_URL;
    const rolarUrl = process.env.ROLAR_URL;

    _.set(baseCfg, "http.enabled", false);
    _.set(baseCfg, "ws.enabled", false);
    _.set(baseCfg, "cluster.enabled", false);
    _.set(baseCfg, "applicationEvents.enabled", false);

    _.set(baseCfg, "sdm.extensionPacks", [
        goalStateSupport({
            cancellation: {
                enabled: false,
            },
        }),
        githubGoalStatusSupport(),
        ...(!!bucket ? [gcpSupport({ compression: CompressionMethod.ZIP })] : []),
    ]);
    _.set(baseCfg, "sdm.projectLoader", ProjectLoader);
    _.set(baseCfg, "sdm.goal.timeout", 1200000);
    _.set(baseCfg, "sdm.cache", {
        enabled: true,
        bucket,
        path: !bucket ? "/tmp/sdm" : undefined,
    });
    _.set(baseCfg, "sdm.rolar.webAppUrl", dashboardUrl);
    _.set(baseCfg, "sdm.rolar.url", rolarUrl);

    baseCfg.apiKey = apiKey;
    baseCfg.workspaceIds = [workspaceId];
    baseCfg.policy = "ephemeral";
    baseCfg.requestProcessorFactory = RequestProcessMaker;

    if (!!graphqlEndpoint) {
        _.set(baseCfg, "endpoints.graphql", `${graphqlEndpoint}/team`);
    }

    const cfg = await loadConfiguration(Promise.resolve(baseCfg));
    cfg.logging = undefined;
    return cfg;
}
