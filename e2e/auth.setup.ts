import { test as setup } from "@playwright/test";

import { authFile, type DemoUserKey, signInWithApi } from "./helpers";

/** One session per role, reused by the specs (`test.use({ storageState: authFile(key) })`). */
const roles: DemoUserKey[] = [
  "owner",
  "salesManager",
  "salesAgent",
  "cashier",
  "technicalManager",
  "propertyManager",
  "resident",
];

for (const key of roles) {
  setup(`sign in as ${key}`, async ({ request, baseURL }) => {
    await signInWithApi(request, baseURL ?? "", key);
    await request.storageState({ path: authFile(key) });
  });
}
