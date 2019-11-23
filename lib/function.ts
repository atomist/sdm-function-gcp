import {
    CommandIncoming,
    Configuration,
    EventIncoming,
    logger,
} from "@atomist/automation-client";
import { automationClient } from "@atomist/automation-client/lib/automationClient";
import { loadConfiguration } from "@atomist/automation-client/lib/configuration";
import {
    isCommandIncoming,
    isEventIncoming,
} from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { CachingProjectLoader } from "@atomist/sdm";
import { configureYaml } from "@atomist/sdm-core";
import * as _ from "lodash";
import * as path from "path";
import { RequestProcessMaker } from "./support/requestProcessor";

const ProjectLoader = new CachingProjectLoader();

export const sdm = async (pubSubEvent: any, context: any) => {
    const payload: CommandIncoming | EventIncoming =
        JSON.parse(Buffer.from(pubSubEvent.message.data, "base64").toString());

    const cfg = await prepareConfiguration();
    const client = automationClient(cfg, RequestProcessMaker);
    await client.run();

    if (isCommandIncoming(payload)) {
        try {
            await new Promise<void>((resolve, reject) => {
                client.processCommand(payload, pResults => {
                    pResults.then(results => {
                        logger.debug("Processing command completed with results %j", results);
                        resolve();
                    }, reject);
                });
            });
        } catch (e) {
            logger.error(`Processing command failed: ${e.message}`);
        }
    } else if (isEventIncoming(payload)) {
        try {
            await new Promise<void>((resolve, reject) => {
                client.processEvent(payload, pResults => {
                    pResults.then(results => {
                        logger.debug("Processing event completed with results %j", results);
                        resolve();
                    }, reject);
                });
            });
        } catch (e) {
            logger.error(`Processing event failed: ${e.message}`);
        }
    }
};

async function prepareConfiguration(): Promise<Configuration> {
    const baseCfg = await configureYaml(
        "*.yaml",
        { cwd: path.resolve(__dirname, "..", "..", "..", "..")}) as any;
    _.set(baseCfg, "http.enabled", false);
    _.set(baseCfg, "ws.enabled", false);
    _.set(baseCfg, "sdm.extensionPacks", []);
    _.set(baseCfg, "sdm.projectLoader", ProjectLoader);
    return loadConfiguration(baseCfg);
}
