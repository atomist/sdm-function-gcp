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
    Configuration,
    loadConfiguration,
} from "@atomist/automation-client/lib/configuration";
import { configureYaml } from "@atomist/sdm-core/lib/machine/yaml/configureYaml";
import { gcpSupport } from "@atomist/sdm-pack-gcp/lib/gcp";
import { CachingProjectLoader } from "@atomist/sdm/lib/api-helper/project/CachingProjectLoader";
import * as _ from "lodash";
import * as path from "path";
import { RequestProcessMaker } from "./requestProcessor";

const ProjectLoader = new CachingProjectLoader();

export async function prepareConfiguration(workspaceId: string, apiKey: string): Promise<Configuration> {
    const baseCfg = await configureYaml(
        "*.yaml",
        { cwd: path.resolve(__dirname, "..", "..", "..", "..", "..") });

    const bucket = process.env.STORAGE?.toLowerCase().replace(/gs:\/\//g, "");

    _.set(baseCfg, "http.enabled", false);
    _.set(baseCfg, "ws.enabled", false);
    _.set(baseCfg, "logging.level", "debug");
    _.set(baseCfg, "logging.color", false);
    _.set(baseCfg, "cluster.enabled", false);

    _.set(baseCfg, "sdm.extensionPacks", [
        ...(!!bucket ? [gcpSupport()] : []),
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
    baseCfg.requestProcessorFactory = RequestProcessMaker;

    return loadConfiguration(Promise.resolve(baseCfg));
}
