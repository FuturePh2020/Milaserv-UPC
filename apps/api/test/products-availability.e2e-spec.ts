import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { ProductsService } from "../src/products/products.service";

/**
 * Proves the product-catalog correctness rules from spec sections 28-30:
 * duplicate item code/barcode rejection, and that agent search only ever
 * returns active+non-archived items filtered by cash/insurance/partner
 * availability.
 */
describe("Products availability & validation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productsService: ProductsService;

  let actorId: string;
  let partnerId: string;
  const suffix = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    productsService = app.get(ProductsService);

    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    actorId = admin!.id;

    const partner = await prisma.partner.create({ data: { name: "Product Test Partner", code: `PROD-PARTNER-${suffix}` } });
    partnerId = partner.id;
  }, 30_000);

  afterAll(async () => {
    await prisma.productPartner.deleteMany({ where: { partnerId } });
    await prisma.product.deleteMany({ where: { itemCode: { startsWith: `TEST-${suffix}` } } });
    await prisma.partner.delete({ where: { id: partnerId } }).catch(() => undefined);
    await app.close();
  }, 30_000);

  it("rejects a duplicate Item Code", async () => {
    await productsService.create({ itemCode: `TEST-${suffix}-A`, englishName: "Test Product A" }, actorId);
    await expect(productsService.create({ itemCode: `TEST-${suffix}-A`, englishName: "Duplicate" }, actorId)).rejects.toThrow(
      "This Item Code already exists.",
    );
  });

  it("rejects a duplicate Barcode", async () => {
    await productsService.create({ itemCode: `TEST-${suffix}-B`, englishName: "Test Product B", barcode: `BC-${suffix}` }, actorId);
    await expect(
      productsService.create({ itemCode: `TEST-${suffix}-C`, englishName: "Another Product", barcode: `BC-${suffix}` }, actorId),
    ).rejects.toThrow("This Barcode is already assigned to another Item.");
  });

  it("excludes inactive and archived items from agent search", async () => {
    const active = await productsService.create({ itemCode: `TEST-${suffix}-ACTIVE`, englishName: `Findable ${suffix}` }, actorId);
    const inactive = await productsService.create({ itemCode: `TEST-${suffix}-INACTIVE`, englishName: `Findable ${suffix}` }, actorId);
    await productsService.setStatus(inactive.id, false, actorId);
    const archived = await productsService.create({ itemCode: `TEST-${suffix}-ARCHIVED`, englishName: `Findable ${suffix}` }, actorId);
    await productsService.archive(archived.id, actorId);

    const results = await productsService.searchForAgents({ query: `Findable ${suffix}` });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain(archived.id);
  });

  it("filters by cash/insurance availability", async () => {
    const cashOnly = await productsService.create(
      { itemCode: `TEST-${suffix}-CASHONLY`, englishName: `Avail ${suffix}`, cashAvailable: true, insuranceAvailable: false },
      actorId,
    );
    const insuranceOnly = await productsService.create(
      { itemCode: `TEST-${suffix}-INSONLY`, englishName: `Avail ${suffix}`, cashAvailable: false, insuranceAvailable: true },
      actorId,
    );

    const cashResults = await productsService.searchForAgents({ query: `Avail ${suffix}`, orderType: "CASH" });
    expect(cashResults.map((r) => r.id)).toContain(cashOnly.id);
    expect(cashResults.map((r) => r.id)).not.toContain(insuranceOnly.id);

    const insuranceResults = await productsService.searchForAgents({ query: `Avail ${suffix}`, orderType: "INSURANCE" });
    expect(insuranceResults.map((r) => r.id)).toContain(insuranceOnly.id);
    expect(insuranceResults.map((r) => r.id)).not.toContain(cashOnly.id);
  });

  it("excludes an item explicitly disabled for a partner from that partner's search", async () => {
    const product = await productsService.create({ itemCode: `TEST-${suffix}-PARTNERED`, englishName: `Partnered ${suffix}` }, actorId);
    await productsService.setPartnerAvailability(product.id, partnerId, { active: false }, actorId);

    const withoutPartner = await productsService.searchForAgents({ query: `Partnered ${suffix}` });
    expect(withoutPartner.map((r) => r.id)).toContain(product.id);

    const withPartner = await productsService.searchForAgents({ query: `Partnered ${suffix}`, partnerId });
    expect(withPartner.map((r) => r.id)).not.toContain(product.id);
  });
});
