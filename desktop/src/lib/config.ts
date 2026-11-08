import defaults from "@shared/config/defaults.json";
import type { AppConfig } from "../generated/schema-types";

/** The central config. Every tunable the UI uses comes from here. */
export const config = defaults as AppConfig;
