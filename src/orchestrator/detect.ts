import type { DiffContext, DetectedContext, SkillMetadata } from "../types.js";
import type { Logger } from "../logger.js";

// ---- Extension -> language map ----

const EXTENSION_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".cs": "csharp",
  ".swift": "swift",
  ".php": "php",
  ".scala": "scala",
  ".dart": "dart",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".c": "c",
  ".h": "c",
};

// ---- Framework detection rules ----
// Each rule checks file paths or content for signals.

interface FrameworkRule {
  id: string;
  /** File path patterns that indicate this framework (checked via includes) */
  fileIndicators: string[];
  /** Content strings searched across all changed file contents */
  contentIndicators: string[];
}

const FRAMEWORK_RULES: FrameworkRule[] = [
  {
    id: "react",
    fileIndicators: [],
    contentIndicators: [
      "from \"react\"",
      "from 'react'",
      "import React",
      "useState",
      "useEffect",
    ],
  },
  {
    id: "nextjs",
    fileIndicators: ["next.config", "app/layout.", "pages/_app."],
    contentIndicators: ["from \"next/", "from 'next/", "next/image", "next/link"],
  },
  {
    id: "nestjs",
    fileIndicators: [],
    contentIndicators: [
      "@nestjs/",
      "from \"@nestjs",
      "from '@nestjs",
      "@Controller",
      "@Injectable",
      "NestFactory",
    ],
  },
  {
    id: "express",
    fileIndicators: [],
    contentIndicators: [
      "from \"express\"",
      "from 'express'",
      "require(\"express\")",
      "require('express')",
      "express()",
    ],
  },
  {
    id: "spring-boot",
    fileIndicators: ["pom.xml", "build.gradle"],
    contentIndicators: [
      "spring-boot",
      "SpringApplication",
      "@SpringBootApplication",
      "org.springframework",
    ],
  },
  {
    id: "django",
    fileIndicators: ["manage.py", "settings.py", "urls.py"],
    contentIndicators: [
      "from django",
      "import django",
      "INSTALLED_APPS",
      "django.contrib",
    ],
  },
  {
    id: "fastapi",
    fileIndicators: [],
    contentIndicators: [
      "from fastapi",
      "import fastapi",
      "FastAPI()",
      "@app.get",
      "@app.post",
    ],
  },
  {
    id: "flask",
    fileIndicators: [],
    contentIndicators: [
      "from flask",
      "import flask",
      "Flask(__name__)",
    ],
  },
  {
    id: "gin",
    fileIndicators: [],
    contentIndicators: ["github.com/gin-gonic/gin", "gin.Default()", "gin.New()"],
  },
  {
    id: "fiber",
    fileIndicators: [],
    contentIndicators: ["github.com/gofiber/fiber", "fiber.New()"],
  },
  {
    id: "vue",
    fileIndicators: ["vue.config", "nuxt.config"],
    contentIndicators: ["from \"vue\"", "from 'vue'", "defineComponent", "createApp"],
  },
  {
    id: "angular",
    fileIndicators: ["angular.json"],
    contentIndicators: ["@angular/core", "@Component", "@NgModule"],
  },
];

// ---- Pattern detection rules ----

interface PatternRule {
  id: string;
  pathIndicators: RegExp[];
  contentIndicators: RegExp[];
}

const PATTERN_RULES: PatternRule[] = [
  {
    id: "rest-api",
    pathIndicators: [/\/api\//, /controller/i, /routes?\//i, /endpoint/i],
    contentIndicators: [
      /\.(get|post|put|patch|delete)\s*\(/,
      /@(Get|Post|Put|Patch|Delete)\b/,
      /router\.(get|post|put|patch|delete)/,
      /RequestMapping|@RestController/,
    ],
  },
  {
    id: "frontend-ui",
    pathIndicators: [
      /\.(tsx|jsx|vue|svelte|html|css|scss|sass|less)$/i,
      /components?\//i,
      /pages?\//i,
      /views?\//i,
      /ui\//i,
    ],
    contentIndicators: [
      /<([A-Z][A-Za-z0-9]*)\b/,
      /className\s*=/,
      /aria-[a-z-]+\s*=/,
      /role\s*=/,
      /tabIndex\s*=/,
      /useState\s*\(/,
      /defineComponent\s*\(/,
      /<template>/i,
    ],
  },
  {
    id: "database",
    pathIndicators: [/migration/i, /schema/i, /model/i, /repositor/i, /dao/i],
    contentIndicators: [
      /SELECT\s+.+\s+FROM\s+/i,
      /INSERT\s+INTO/i,
      /CREATE\s+TABLE/i,
      /\.query\s*\(/,
      /prisma\./,
      /sequelize/i,
      /typeorm/i,
      /mongoose\./,
      /from\s+['"]knex/,
    ],
  },
  {
    id: "auth",
    pathIndicators: [/auth/i, /login/i, /session/i, /passport/i],
    contentIndicators: [
      /jwt\b/i,
      /bcrypt/i,
      /passport\b/i,
      /OAuth/i,
      /bearer\s+token/i,
      /signIn|signUp|signOut/i,
      /@PreAuthorize/,
      /authenticate/i,
    ],
  },
  {
    id: "cli",
    pathIndicators: [/cli/i, /bin\//],
    contentIndicators: [
      /commander/,
      /yargs/,
      /argparse/,
      /cobra\.Command/,
      /process\.argv/,
      /oclif/,
    ],
  },
  {
    id: "testing",
    pathIndicators: [/\.test\.|\.spec\.|__tests__/],
    contentIndicators: [
      /describe\s*\(/,
      /it\s*\(/,
      /expect\s*\(/,
      /assert\b/,
      /jest\b/,
      /vitest/,
      /pytest/,
      /@Test\b/,
    ],
  },
  {
    id: "messaging",
    pathIndicators: [/queue/i, /consumer/i, /producer/i, /event/i],
    contentIndicators: [
      /kafka/i,
      /rabbitmq/i,
      /amqplib/,
      /bull\b/,
      /SQS/,
      /EventEmitter/,
      /pubsub/i,
    ],
  },
];

// ---- Main detection function ----

export function detectProjectContext(diff: DiffContext, logger: Logger): DetectedContext {
  const language = detectLanguage(diff, logger);
  const framework = detectFrameworks(diff, logger);
  const patterns = detectPatterns(diff, logger);
  const primaryChangedAreas = extractChangedAreas(diff);

  logger.info(
    `Detected: language=${language}, frameworks=[${framework.join(", ")}], patterns=[${patterns.join(", ")}]`,
  );
  logger.debug("Detection details", {
    areas: primaryChangedAreas,
    fileCount: diff.files.length,
  });

  return {
    language,
    framework,
    patterns,
    fileCount: diff.files.length,
    primaryChangedAreas,
  };
}

// ---- Skill filtering ----

export interface SkillFilterResult {
  matched: SkillMetadata[];
  skipped: { skill: SkillMetadata; reason: string }[];
}

export function filterSkills(
  ctx: DetectedContext,
  skills: SkillMetadata[],
  logger: Logger
): SkillFilterResult {
  const matched: SkillMetadata[] = [];
  const skipped: { skill: SkillMetadata; reason: string }[] = [];

  for (const skill of skills) {
    const reasons: string[] = [];

    if (skill.requires.language && !matchesField(skill.requires.language, [ctx.language])) {
      reasons.push(`language: requires [${skill.requires.language.join(", ")}], detected ${ctx.language}`);
    }

    if (skill.requires.framework && !matchesField(skill.requires.framework, ctx.framework)) {
      reasons.push(`framework: requires [${skill.requires.framework.join(", ")}], detected [${ctx.framework.join(", ")}]`);
    }

    if (skill.requires.patterns && !matchesField(skill.requires.patterns, ctx.patterns)) {
      reasons.push(`patterns: requires [${skill.requires.patterns.join(", ")}], detected [${ctx.patterns.join(", ")}]`);
    }

    if (reasons.length === 0) {
      matched.push(skill);
      logger.debug(`Skill "${skill.id}" matched`);
    } else {
      skipped.push({ skill, reason: reasons.join("; ") });
      logger.debug(`Skill "${skill.id}" skipped: ${reasons.join("; ")}`);
    }
  }

  logger.info(`Skills: ${matched.length} matched, ${skipped.length} skipped`);

  return { matched, skipped };
}

/**
 * Returns true if the requirement list matches the detected values.
 * ["*"] matches anything. Otherwise, at least one required value
 * must appear in the detected set.
 */
function matchesField(required: string[], detected: string[]): boolean {
  if (required.includes("*")) return true;
  return required.some((r) => detected.includes(r));
}

// ---- Internal helpers ----

function detectLanguage(diff: DiffContext, logger: Logger): string {
  const counts = new Map<string, number>();

  for (const file of diff.files) {
    const ext = extname(file.path);
    const lang = EXTENSION_LANGUAGE[ext];
    if (lang) {
      counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
  }

  if (counts.size === 0) {
    logger.debug("Language detection: no recognized extensions");
    return "unknown";
  }

  logger.debug("Language detection votes", {
    votes: Object.fromEntries(counts),
  });

  let maxLang = "unknown";
  let maxCount = 0;
  for (const [lang, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
    }
  }
  return maxLang;
}

function detectFrameworks(diff: DiffContext, logger: Logger): string[] {
  const allPaths = diff.files.map((f) => f.path);
  const allContent = diff.files
    .map((f) => f.content ?? f.diff)
    .join("\n");

  const detected: string[] = [];

  for (const rule of FRAMEWORK_RULES) {
    const pathMatch = rule.fileIndicators.some((indicator) =>
      allPaths.some((p) => p.includes(indicator))
    );
    const contentMatch = rule.contentIndicators.some((indicator) =>
      allContent.includes(indicator)
    );

    if (pathMatch || contentMatch) {
      detected.push(rule.id);
      const matchedVia = pathMatch && contentMatch ? "path+content" : pathMatch ? "path" : "content";
      logger.debug(`Framework "${rule.id}" matched via ${matchedVia}`);
    }
  }

  return detected;
}

function detectPatterns(diff: DiffContext, logger: Logger): string[] {
  const allPaths = diff.files.map((f) => f.path);
  const allContent = diff.files
    .map((f) => f.content ?? f.diff)
    .join("\n");

  const detected: string[] = [];

  for (const rule of PATTERN_RULES) {
    const pathMatch = rule.pathIndicators.some((re) =>
      allPaths.some((p) => re.test(p))
    );
    const contentMatch = rule.contentIndicators.some((re) => re.test(allContent));

    if (pathMatch || contentMatch) {
      detected.push(rule.id);
      const matchedVia = pathMatch && contentMatch ? "path+content" : pathMatch ? "path" : "content";
      logger.debug(`Pattern "${rule.id}" matched via ${matchedVia}`);
    }
  }

  return detected;
}

function extractChangedAreas(diff: DiffContext): string[] {
  const areas = new Set<string>();

  for (const file of diff.files) {
    const parts = file.path.split("/");
    const skipDirs = new Set(["src", "lib", "app", "pkg", "internal", "cmd"]);
    for (const part of parts.slice(0, -1)) {
      if (!skipDirs.has(part)) {
        areas.add(part);
        break;
      }
    }
  }

  return [...areas].slice(0, 10);
}

function extname(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return "";
  return filePath.slice(lastDot);
}
