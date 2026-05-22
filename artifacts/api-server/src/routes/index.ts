import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import productsRouter from "./products";
import servicesRouter from "./services";
import cartRouter from "./cart";
import ordersRouter from "./orders";
import galleryRouter from "./gallery";
import reviewsRouter from "./reviews";
import deliveryRouter from "./delivery";
import dashboardRouter from "./dashboard";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(productsRouter);
router.use(servicesRouter);
router.use(cartRouter);
router.use(ordersRouter);
router.use(galleryRouter);
router.use(reviewsRouter);
router.use(deliveryRouter);
router.use(dashboardRouter);
router.use(adminRouter);

export default router;
