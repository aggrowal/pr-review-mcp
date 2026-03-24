import type { SkillModule } from "../types.js";

import * as correctness from "./correctness/index.js";
import * as securityGeneric from "./security-generic/index.js";
import * as redundancy from "./redundancy/index.js";
import * as performanceScalability from "./performance-scalability/index.js";
import * as reliabilityResilience from "./reliability-resilience/index.js";
import * as apiContractCompatibility from "./api-contract-compatibility/index.js";
import * as testingQuality from "./testing-quality/index.js";
import * as observabilityOperability from "./observability-operability/index.js";
import * as maintainabilityDesign from "./maintainability-design/index.js";
import * as accessibilityI18n from "./accessibility-i18n/index.js";

export const SKILL_REGISTRY: SkillModule[] = [
  correctness,
  securityGeneric,
  redundancy,
  performanceScalability,
  reliabilityResilience,
  apiContractCompatibility,
  testingQuality,
  observabilityOperability,
  maintainabilityDesign,
  accessibilityI18n,
];
