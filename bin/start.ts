import { listen } from "../lib/http";

listen(+(process.env.PORT || 8080));
