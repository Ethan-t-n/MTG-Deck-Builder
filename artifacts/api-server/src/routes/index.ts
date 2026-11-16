import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import decksRouter from "./decks";
import threadsRouter from "./threads";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catalogRouter);
router.use("/decks", requireAuth);
router.use(decksRouter);
router.use(threadsRouter);

export default router;
