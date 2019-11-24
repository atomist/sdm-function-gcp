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
