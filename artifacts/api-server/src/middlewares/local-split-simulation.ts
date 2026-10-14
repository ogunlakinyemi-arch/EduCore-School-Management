import type { RequestHandler } from "express";
import { assertNoLocalSplitSimulation, LOCAL_SPLIT_SIMULATION_PATH } from "../lib/local-split-simulation-barrier";

/** Mounted before operational handlers; the isolated simulation endpoint alone is exempt. */
export const rejectOperationalSimulation: RequestHandler = (req,res,next) => {
  const path = req.path ?? req.url.split("?")[0];
  if (path === LOCAL_SPLIT_SIMULATION_PATH && ["GET","POST"].includes(req.method)) return next();
  try { assertNoLocalSplitSimulation([req.body,req.originalUrl]); next(); }
  catch { res.status(400).json({error:"TEST / NOT REAL simulation data is forbidden in operational recipient, configuration, checkout, payment and webhook requests"}); }
};

/** Raw webhook body is inspected without replacing/mutating signed bytes. */
export const rejectSimulationWebhook: RequestHandler = (req,res,next) => {
  try { assertNoLocalSplitSimulation(req.body); next(); }
  catch { res.status(400).json({error:"TEST / NOT REAL simulation data cannot be a provider webhook"}); }
};
