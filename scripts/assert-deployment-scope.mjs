const isVercelProduction =
  process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
const productionApproved = process.env.ALLOW_PRODUCTION_DEPLOYMENT === "true";

if (isVercelProduction && !productionApproved) {
  console.error(
    "Production deployment is disabled. Gate F requires explicit owner approval.",
  );
  process.exit(1);
}
