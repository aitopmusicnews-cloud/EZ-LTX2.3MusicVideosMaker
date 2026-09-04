import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  DirectorReasoningHttpError,
  compileScriptLockedDirector,
  editScriptLockedDirector,
} from "./director_scriptlocked_client.js";
import {
  ScriptLockedCompileRequestSchema,
  ScriptLockedEditRequestSchema,
} from "./director_scriptlocked_contract.js";

function replyError(reply: any, error: unknown) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: "invalid_request", message: error.issues.map((issue) => issue.message).join("; ") });
  }
  if (error instanceof DirectorReasoningHttpError) {
    return reply.code(error.status).send({ error: error.code, message: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return reply.code(500).send({ error: "scriptlocked_error", message });
}

export async function registerScriptLockedDirectorRoutes(app: FastifyInstance) {
  app.post("/api/director/scriptlocked/compile", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
      const body = ScriptLockedCompileRequestSchema.parse(req.body);
      return reply.send(await compileScriptLockedDirector(body));
    } catch (error) {
      req.log.error({ err: error }, "Script-Locked Director compile failed");
      return replyError(reply, error);
    }
  });

  app.post("/api/director/scriptlocked/edit", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
      const body = ScriptLockedEditRequestSchema.parse(req.body);
      return reply.send(await editScriptLockedDirector(body));
    } catch (error) {
      req.log.error({ err: error }, "Script-Locked Director edit failed");
      return replyError(reply, error);
    }
  });
}
