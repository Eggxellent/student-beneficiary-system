const { checkDuplicate } = require("../src/services/duplicateCheck");

describe("Duplicate Detection Performance", () => {
  test("duplicate prediction should complete within 3 seconds", async () => {
    const features = {
      jaro_winkler: 0.95,
      dob_match: 1,
      school_match: 1,
      guardian_match: 1,
      upi_match: 1,
    };

    await checkDuplicate(features);
    const start = process.hrtime.bigint();

    const result = await checkDuplicate(features);

    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1_000_000;

    console.log(`Duplicate prediction time: ${elapsedMs.toFixed(2)} ms`);
    console.log(`Prediction result:`, result);

    expect(result).toBeDefined();
    expect(result.probability).toBeDefined();
    expect(elapsedMs).toBeLessThan(3000);
  }, 30000);
});
