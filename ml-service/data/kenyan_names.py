# Kenyan synthetic name bank for SBMS
# Used only to generate synthetic student records.

FIRST_NAMES = [
    # Kikuyu / Central
    "Wanjiku", "Wambui", "Nyambura", "Muthoni", "Wangari",
    "Njeri", "Njoki", "Wairimu", "Mumbi", "Wanjiru",
    "Mwangi", "Kamau", "Kariuki", "Njoroge", "Maina",
    "Mbugua", "Gichuru", "Kihoro", "Waweru", "Kinyanjui",

    # Luo / Western
    "Achieng", "Atieno", "Adhiambo", "Awino", "Akoth",
    "Anyango", "Auma", "Apiyo", "Odhiambo", "Ochieng",
    "Otieno", "Okello", "Omondi", "Onyango", "Ouma",
    "Owino", "Were", "Obiero", "Juma", "Oduor",

    # Luhya
    "Nanjala", "Nekesa", "Naliaka", "Nasimiyu", "Nabwire",
    "Nakhumicha", "Namisi", "Nanjala", "Barasa", "Wekesa",
    "Wafula", "Wanyonyi", "Khamisi", "Makokha", "Mukhwana",
    "Shitanda", "Lutiali", "Masinde", "Simiyu", "Musungu",

    # Kalenjin
    "Jepchirchir", "Jepkemoi", "Chebet", "Cherotich", "Chepkoech",
    "Chepkirui", "Jelagat", "Chepngeno", "Kiptoo", "Kipchoge",
    "Kiprotich", "Koech", "Korir", "Kibet", "Rono",
    "Tanui", "Rotich", "Bett", "Too", "Sang",

    # Coastal / Swahili
    "Asha", "Fatuma", "Zainab", "Halima", "Saida",
    "Mariam", "Salma", "Hawa", "Amina", "Nadia",
    "Abdullahi", "Hassan", "Hussein", "Juma", "Ali",
    "Omar", "Bakari", "Hamisi", "Said", "Salim",

    # Common Kenyan names
    "Brian", "Kevin", "Dennis", "Daniel", "Samuel",
    "David", "Michael", "Joseph", "John", "James",
    "Mary", "Jane", "Faith", "Mercy", "Esther",
    "Ann", "Grace", "Lucy", "Caroline", "Elizabeth"
]

SURNAMES = [
    # Kikuyu / Central
    "Kamau", "Mwangi", "Kariuki", "Njoroge", "Maina",
    "Mbugua", "Gichuru", "Waweru", "Kinyanjui", "Muthoni",
    "Njenga", "Karanja", "Kagwe", "Wanjohi", "Muriuki",

    # Luo
    "Odhiambo", "Ochieng", "Otieno", "Okello", "Omondi",
    "Onyango", "Ouma", "Owino", "Obiero", "Oduor",
    "Were", "Awuor", "Awiti", "Juma", "Anyango",

    # Luhya
    "Barasa", "Wekesa", "Wafula", "Wanyonyi", "Khamisi",
    "Makokha", "Mukhwana", "Shitanda", "Masinde", "Simiyu",
    "Musungu", "Lutiali", "Nabutete", "Ingutia", "Kiboi",

    # Kalenjin
    "Kiptoo", "Kipchoge", "Kiprotich", "Koech", "Korir",
    "Kibet", "Rono", "Tanui", "Rotich", "Bett",
    "Sang", "Too", "Kipkorir", "Cheruiyot", "Kipngeno",

    # Coastal / Swahili
    "Abdullahi", "Hassan", "Hussein", "Juma", "Ali",
    "Omar", "Bakari", "Hamisi", "Said", "Salim",
    "Mohamed", "Abdalla", "Ahmed", "Yusuf", "Mbarak",

    # Other common Kenyan surnames
    "Mutua", "Musau", "Nduati", "Macharia", "Gathoni",
    "Wambua", "Munyao", "Muli", "Mumo", "Munya",
    "Moraa", "Nyakundi", "Nyaboke", "Onyango", "Omondi"
]

SCHOOLS = [
    "SCH001",
    "SCH002",
    "SCH003",
    "SCH004",
    "SCH005",
    "SCH006",
    "SCH007",
    "SCH008",
    "SCH009",
    "SCH010"
]

def get_name_counts():
    return {
        "first_names": len(FIRST_NAMES),
        "surnames": len(SURNAMES),
        "schools": len(SCHOOLS)
    }

if __name__ == "__main__":
    print("Kenyan name bank loaded successfully.")
    print(get_name_counts())
