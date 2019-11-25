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

import * as bodyParser from "body-parser";
import * as express from "express";
import { sdm } from "./function";

export function listen(port: number): void {

    const app = express();

    app.use(bodyParser.json());
    app.post("/", async (req: express.Request, res: express.Response) => {
        if (!req.body || !req.body.message) {
            res.status(400).send("Bad Request");
            return;
        }

        const pubSubMessage = req.body.message;
        await sdm(pubSubMessage);
        res.status(204).send();
    });

    app.listen(port);
}