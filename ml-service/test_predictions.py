from predict import predict_duplicate


def student(name, dob, school, guardian, upi, birth_certificate_number=None):
    certificate_number = birth_certificate_number or f"BC-{upi}"
    return {
        "full_name": name,
        "date_of_birth": dob,
        "school_code": school,
        "guardian_id": guardian,
        "upi": upi,
        "birth_certificate_number": certificate_number,
    }


cases = [

    # ============================================================
    # 1–10: VERY STRONG DUPLICATE CASES
    # ============================================================

    (
        "01 - Exact same student",
        student("Brian Otieno", "2005-04-12", "SCH001", "G001", "UPI-10000001"),
        student("Brian Otieno", "2005-04-12", "SCH001", "G001", "UPI-10000001"),
        "DUPLICATE",
    ),

    (
        "02 - Same UPI, slight name typo",
        student("Mary Wanjiku", "2006-06-18", "SCH002", "G002", "UPI-10000002"),
        student("Mary Wanjiku", "2006-06-18", "SCH002", "G002", "UPI-10000002"),
        "DUPLICATE",
    ),

    (
        "03 - Same UPI, different name formatting",
        student("Peter Ochieng", "2004-02-20", "SCH003", "G003", "UPI-10000003"),
        student("Peter  Ochieng", "2004-02-20", "SCH003", "G003", "UPI-10000003"),
        "DUPLICATE",
    ),

    (
        "04 - Same UPI, all supporting attributes match",
        student("Faith Njeri", "2007-09-10", "SCH004", "G004", "UPI-10000004"),
        student("Faith Njeri", "2007-09-10", "SCH004", "G004", "UPI-10000004"),
        "DUPLICATE",
    ),

    (
        "05 - Same UPI, different school recorded",
        student("Kevin Kiptoo", "2005-01-15", "SCH005", "G005", "UPI-10000005"),
        student("Kevin Kiptoo", "2005-01-15", "SCH006", "G005", "UPI-10000005"),
        "DUPLICATE",
    ),

    (
        "06 - Same UPI, guardian changed",
        student("Amina Hassan", "2006-03-22", "SCH007", "G006", "UPI-10000006"),
        student("Amina Hassan", "2006-03-22", "SCH007", "G099", "UPI-10000006"),
        "DUPLICATE",
    ),

    (
        "07 - Same UPI, DOB typo in record",
        student("Samuel Mwangi", "2005-11-08", "SCH008", "G007", "UPI-10000007"),
        student("Samuel Mwangi", "2005-11-09", "SCH008", "G007", "UPI-10000007"),
        "DUPLICATE",
    ),

    (
        "08 - Same UPI, surname variation",
        student("Jane Wambui", "2006-07-12", "SCH009", "G008", "UPI-10000008"),
        student("Jane Wambui", "2006-07-12", "SCH009", "G008", "UPI-10000008"),
        "DUPLICATE",
    ),

    (
        "09 - Same UPI, school transfer",
        student("Collins Omondi", "2004-12-01", "SCH010", "G009", "UPI-10000009"),
        student("Collins Omondi", "2004-12-01", "SCH011", "G009", "UPI-10000009"),
        "DUPLICATE",
    ),

    (
        "10 - Same UPI, several fields match",
        student("Lucy Chebet", "2007-05-14", "SCH012", "G010", "UPI-10000010"),
        student("Lucy Chebet", "2007-05-14", "SCH012", "G010", "UPI-10000010"),
        "DUPLICATE",
    ),

    # ============================================================
    # 11–20: SAME NAME / SIMILAR NAME BUT DIFFERENT STUDENTS
    # ============================================================

    (
        "11 - Same name, different UPI and DOB",
        student("Brian Otieno", "2005-04-12", "SCH001", "G001", "UPI-10000011"),
        student("Brian Otieno", "2007-08-21", "SCH004", "G021", "UPI-10000012"),
        "NON-DUPLICATE",
    ),

    (
        "12 - Same name, different school",
        student("Mary Wanjiku", "2006-06-18", "SCH002", "G002", "UPI-10000013"),
        student("Mary Wanjiku", "2006-06-18", "SCH013", "G013", "UPI-10000014"),
        "NON-DUPLICATE",
    ),

    (
        "13 - Same surname, different student",
        student("Peter Ochieng", "2004-02-20", "SCH003", "G003", "UPI-10000015"),
        student("John Ochieng", "2006-09-11", "SCH014", "G014", "UPI-10000016"),
        "NON-DUPLICATE",
    ),

    (
        "14 - Similar names, different details",
        student("Brian Otieno", "2005-04-12", "SCH001", "G001", "UPI-10000017"),
        student("Brian Ochieng", "2007-03-17", "SCH015", "G015", "UPI-10000018"),
        "NON-DUPLICATE",
    ),

    (
        "15 - Same first name, different student",
        student("Faith Njeri", "2007-09-10", "SCH004", "G004", "UPI-10000019"),
        student("Faith Akinyi", "2006-01-23", "SCH016", "G016", "UPI-10000020"),
        "NON-DUPLICATE",
    ),

    (
        "16 - Similar surname",
        student("Samuel Mwangi", "2005-11-08", "SCH008", "G007", "UPI-10000021"),
        student("Samuel Wangui", "2006-10-19", "SCH017", "G017", "UPI-10000022"),
        "NON-DUPLICATE",
    ),

    (
        "17 - Same name, same school, different UPI",
        student("Kevin Kiptoo", "2005-01-15", "SCH005", "G005", "UPI-10000023"),
        student("Kevin Kiptoo", "2005-01-15", "SCH005", "G023", "UPI-10000024"),
        "NON-DUPLICATE",
    ),

    (
        "18 - Same name and DOB, different guardian",
        student("Amina Hassan", "2006-03-22", "SCH007", "G006", "UPI-10000025"),
        student("Amina Hassan", "2006-03-22", "SCH018", "G025", "UPI-10000026"),
        "NON-DUPLICATE",
    ),

    (
        "19 - Common Kenyan name",
        student("John Kamau", "2005-05-10", "SCH019", "G019", "UPI-10000027"),
        student("John Kamau", "2007-11-14", "SCH020", "G027", "UPI-10000028"),
        "NON-DUPLICATE",
    ),

    (
        "20 - Similar names, all other details different",
        student("Jane Wambui", "2006-07-12", "SCH009", "G008", "UPI-10000029"),
        student("Jane Wanjiku", "2007-02-18", "SCH021", "G029", "UPI-10000030"),
        "NON-DUPLICATE",
    ),

    # ============================================================
    # 21–30: SUSPICIOUS CASES FOR ML
    # ============================================================

    (
        "21 - Similar name + same DOB + same school",
        student("Brian Otieno", "2005-04-12", "SCH001", "G031", "UPI-10000031"),
        student("Brian Ochieng", "2005-04-12", "SCH001", "G032", "UPI-10000032"),
        "REVIEW",
    ),

    (
        "22 - Similar name + same guardian",
        student("Mary Wanjiku", "2006-06-18", "SCH002", "G033", "UPI-10000033"),
        student("Mary Wambui", "2006-07-18", "SCH022", "G033", "UPI-10000034"),
        "REVIEW",
    ),

    (
        "23 - Same DOB + same school + same guardian",
        student("Peter Ochieng", "2004-02-20", "SCH003", "G035", "UPI-10000035"),
        student("Peter Odhiambo", "2004-02-20", "SCH003", "G035", "UPI-10000036"),
        "REVIEW",
    ),

    (
        "24 - Very similar name + same school",
        student("Samuel Mwangi", "2005-11-08", "SCH008", "G037", "UPI-10000037"),
        student("Samuel Wangui", "2005-11-08", "SCH008", "G038", "UPI-10000038"),
        "REVIEW",
    ),

    (
        "25 - Similar name + same DOB + same guardian",
        student("Lucy Chebet", "2007-05-14", "SCH012", "G039", "UPI-10000039"),
        student("Lucy Cherotich", "2007-05-14", "SCH023", "G039", "UPI-10000040"),
        "REVIEW",
    ),

    (
        "26 - Similar name + same school + guardian",
        student("Collins Omondi", "2004-12-01", "SCH010", "G041", "UPI-10000041"),
        student("Collins Ouma", "2005-12-01", "SCH010", "G041", "UPI-10000042"),
        "REVIEW",
    ),

    (
        "27 - Name typo + same DOB + school",
        student("Kevin Kiptoo", "2005-01-15", "SCH005", "G043", "UPI-10000043"),
        student("Kevin Kiptu", "2005-01-15", "SCH005", "G044", "UPI-10000044"),
        "REVIEW",
    ),

    (
        "28 - Similar name + same guardian + school",
        student("Amina Hassan", "2006-03-22", "SCH007", "G045", "UPI-10000045"),
        student("Amina Hassen", "2006-03-22", "SCH007", "G045", "UPI-10000046"),
        "REVIEW",
    ),

    (
        "29 - Name similarity + DOB match",
        student("John Kamau", "2005-05-10", "SCH019", "G047", "UPI-10000047"),
        student("Jon Kamau", "2005-05-10", "SCH024", "G048", "UPI-10000048"),
        "REVIEW",
    ),

    (
        "30 - Name + school + guardian match",
        student("Faith Njeri", "2007-09-10", "SCH004", "G049", "UPI-10000049"),
        student("Faith Njeri", "2008-09-10", "SCH004", "G049", "UPI-10000050"),
        "REVIEW",
    ),

    # ============================================================
    # 31–40: CLEAR NON-DUPLICATES / EDGE CASES
    # ============================================================

    (
        "31 - Completely different students",
        student("David Kiplangat", "2003-01-10", "SCH025", "G051", "UPI-10000051"),
        student("Aisha Mohammed", "2008-12-22", "SCH026", "G052", "UPI-10000052"),
        "NON-DUPLICATE",
    ),

    (
        "32 - Different names and same school",
        student("Esther Akinyi", "2005-03-14", "SCH027", "G053", "UPI-10000053"),
        student("Joseph Maina", "2006-08-30", "SCH027", "G054", "UPI-10000054"),
        "NON-DUPLICATE",
    ),

    (
        "33 - Different names and same guardian",
        student("Mark Onyango", "2004-06-01", "SCH028", "G055", "UPI-10000055"),
        student("Rose Atieno", "2007-09-02", "SCH029", "G055", "UPI-10000056"),
        "NON-DUPLICATE",
    ),

    (
        "34 - Same DOB only",
        student("Daniel Kibet", "2006-02-14", "SCH030", "G057", "UPI-10000057"),
        student("Mercy Wanjiru", "2006-02-14", "SCH031", "G058", "UPI-10000058"),
        "NON-DUPLICATE",
    ),

    (
        "35 - Same school only",
        student("Ann Wambui", "2005-07-19", "SCH032", "G059", "UPI-10000059"),
        student("Robert Otieno", "2007-11-03", "SCH032", "G060", "UPI-10000060"),
        "NON-DUPLICATE",
    ),

    (
        "36 - Same guardian only",
        student("Victor Omondi", "2004-04-09", "SCH033", "G061", "UPI-10000061"),
        student("Cynthia Achieng", "2006-10-25", "SCH034", "G061", "UPI-10000062"),
        "NON-DUPLICATE",
    ),

    (
        "37 - Name typo but different student",
        student("Grace Njeri", "2005-05-16", "SCH035", "G063", "UPI-10000063"),
        student("Grace Njery", "2007-08-11", "SCH036", "G064", "UPI-10000064"),
        "NON-DUPLICATE",
    ),

    (
        "38 - Similar names but different identities",
        student("Michael Kariuki", "2003-09-21", "SCH037", "G065", "UPI-10000065"),
        student("Micheal Kariuki", "2007-02-13", "SCH038", "G066", "UPI-10000066"),
        "NON-DUPLICATE",
    ),

    (
        "39 - Different students sharing common surname",
        student("Susan Otieno", "2005-01-12", "SCH039", "G067", "UPI-10000067"),
        student("Brian Otieno", "2006-05-22", "SCH040", "G068", "UPI-10000068"),
        "NON-DUPLICATE",
    ),

    (
        "40 - Completely unrelated records",
        student("Patrick Karanja", "2003-03-18", "SCH041", "G069", "UPI-10000069"),
        student("Zainab Abdullahi", "2008-10-29", "SCH042", "G070", "UPI-10000070"),
        "NON-DUPLICATE",
    ),
]

print("=" * 80)
print("SBMS RANDOM FOREST — 40 REALISTIC PREDICTION TESTS")
print("=" * 80)

results = []

for name, first, second, expected in cases:
    result = predict_duplicate(first, second)

    probability = result["duplicate_probability"]
    predicted = "DUPLICATE" if result["is_duplicate"] else "NON-DUPLICATE"

    results.append({
        "name": name,
        "probability": probability,
        "predicted": predicted,
        "expected": expected,
    })

    print(f"\n{name}")
    print(f"  Probability : {probability:.4f}")
    print(f"  Prediction  : {predicted}")
    print(f"  Expected    : {expected}")
    print(f"  Features    : {result['features']}")

print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)

duplicate_predictions = sum(
    1 for result in results
    if result["predicted"] == "DUPLICATE"
)

non_duplicate_predictions = len(results) - duplicate_predictions

print(f"Total cases: {len(results)}")
print(f"Predicted duplicates: {duplicate_predictions}")
print(f"Predicted non-duplicates: {non_duplicate_predictions}")

print("\nProbability range:")
probabilities = [result["probability"] for result in results]
print(f"Minimum: {min(probabilities):.4f}")
print(f"Maximum: {max(probabilities):.4f}")

print("\nCases requiring particular attention:")
for result in results:
    if 0.30 <= result["probability"] <= 0.70:
        print(
            f"  {result['name']}: "
            f"{result['probability']:.4f}"
        )

print("\n" + "=" * 80)
print("IMPORTANT: REVIEW THE OUTPUT RATHER THAN EXPECTING EVERY")
print("CASE TO MATCH THE LABEL. THESE ARE REALISTIC EDGE CASES.")
print("=" * 80)
