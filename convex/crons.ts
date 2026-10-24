import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron("morning deadlines", "0 14 * * *", internal.deadlines.runMorningCheck, {});

export default crons;
