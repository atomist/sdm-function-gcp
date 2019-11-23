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
    HttpMethod,
    ProjectOperationCredentials,
} from "@atomist/automation-client";
import { isTokenCredentials } from "@atomist/automation-client/lib/operations/common/ProjectOperationCredentials";
import { AspectWithReportDetails } from "@atomist/sdm-pack-aspect";
import { sha256 } from "@atomist/sdm-pack-fingerprint";

interface LicenseData {
    key: string;
    name: string;
    spdx: string;
    url: string;
}

export const LicenseAspect: AspectWithReportDetails<LicenseData> = {
    name: "gh-license",
    displayName: "License",
    extract: async (p, pli) => {
        if (!pli.configuration.http || !pli.configuration.http.client || !pli.configuration.http.client.factory) {
            return [];
        }
        const url = `https://api.github.com/repos/${p.id.owner}/${p.id.repo}/license`;
        const client = pli.configuration.http.client.factory.create(url);

        try {
            const data = (await client.exchange<any>(url, {
                method: HttpMethod.Get,
                headers: headers(pli),
                retry: {
                    retries: 0,
                },
            })).body;
            const license = {
                key: data.license.key,
                name: data.license.name,
                spdx: data.license.spdx_id,
                url: data.license.url,
            };
            return {
                type: "gh-license",
                name: "gh-license",
                abbreviation: "lic",
                version: "0.0.1",
                data: license,
                sha: sha256(JSON.stringify(license)),
            };
        } catch (e) {
            const license = {
                key: "unknown",
                name: "Unknown",
                spdx: "unknown",
                url: undefined,
            };
            return {
                type: "gh-license",
                name: "gh-license",
                abbreviation: "lic",
                version: "0.0.1",
                data: license,
                sha: sha256(JSON.stringify(license)),
            };
        }
    },
    apply: async (p, papi) => {
        if (!papi.parameters || !papi.configuration.http || !papi.configuration.http.client || !papi.configuration.http.client.factory) {
            return p;
        }
        const fp = papi.parameters.fp;
        const key = fp.data.key;
        const url = `https://api.github.com/licenses`;
        const licenses = await papi.configuration.http.client.factory.create(url)
            .exchange<Array<{ key: string, url: string }>>(
                url,
                {
                    method: HttpMethod.Get,
                    headers: headers(papi),
                });
        if (!licenses.body) {
            return p;
        }
        const license = licenses.body.find(l => l.key === key);
        if (!license) {
            return p;
        }
        const licenseText = await papi.configuration.http.client.factory.create(license.url)
            .exchange<{ body: string }>(license.url, { method: HttpMethod.Get });
        if (!licenseText.body) {
            return p;
        }
        const licenseFile = await p.getFile("LICENSE");
        if (!!licenseFile) {
            await licenseFile.setContent(licenseText.body.body);
        } else {
            await p.addFile("LICENSE", licenseText.body.body);
        }
        return p;
    },
    toDisplayableFingerprint: fp => fp.data.name,
    toDisplayableFingerprintName: () => "License",
    details: {
        description: "Repository licenses as detected by GitHub",
        shortName: "gh-license",
        unit: "gh-license",
        category: "GitHub",
        url: `fingerprint/gh-license/gh-license?byOrg=true&trim=false`,
        manage: true,
    },
};

export function headers(papi: { credentials: ProjectOperationCredentials }): any {
    if (!!papi.credentials && isTokenCredentials(papi.credentials)) {
        return { Authorization: `Bearer ${(papi.credentials).token}` };
    } else {
        return undefined;
    }
}
