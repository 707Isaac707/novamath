import { createRequire } from 'node:module';
import { runLegacy } from '../server/vercel-bridge.mjs';
const require=createRequire(import.meta.url);
const {handler}=require('../server/functions/food-notify.cjs');
export default async function handlerVercel(req,res){return runLegacy(req,res,handler);}
