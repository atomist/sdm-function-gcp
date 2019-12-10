import { Configuration } from "@atomist/automation-client";
import { loadConfiguration } from "@atomist/automation-client/lib/configuration";
import { CachingProjectLoader } from "@atomist/sdm";
import {
    configureYaml,
    githubGoalStatusSupport,
} from "@atomist/sdm-core";
import { gcpSupport } from "@atomist/sdm-pack-gcp";
import * as _ from "lodash";
import * as path from "path";

const ProjectLoader = new CachingProjectLoader();

export async function prepareConfiguration(workspaceId: string, apiKey: string): Promise<Configuration> {
    const baseCfg = await configureYaml(
        "*.yaml",
        { cwd: path.resolve(__dirname, "..", "..", "..", "..", "..") });

    // For now, let's set the storage bucket
    if (!process.env.STORAGE) {
        process.env.STORAGE = `gs://workspace-storage-${workspaceId.toLowerCase()}`;
    }

    const bucket = process.env.STORAGE?.toLowerCase().replace(/gs:\/\//g, "");

    _.set(baseCfg, "http.enabled", false);
    _.set(baseCfg, "ws.enabled", false);
    _.set(baseCfg, "logging.level", "debug");
    _.set(baseCfg, "logging.color", false);
    _.set(baseCfg, "cluster.enabled", false);

    _.set(baseCfg, "sdm.extensionPacks", [
        githubGoalStatusSupport(),
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

    return loadConfiguration(Promise.resolve(baseCfg));
}
