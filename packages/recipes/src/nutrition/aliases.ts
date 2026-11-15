/**
 * Common ingredient names → Canadian Nutrient File food codes.
 *
 * Every code here was looked up in the CNF 2026 data by description (shown in the
 * comment), and the test suite checks each one still exists. The longest matching
 * phrase wins, so "peanut butter" beats "butter" and "green onion" beats "onion".
 * Defaults follow what a home cook most likely means: raw, plain, 2% milk, medium
 * ground beef, Atlantic farmed salmon, dry rice and pasta.
 * Ingredients not listed fall back to word matching (lower confidence).
 */
export const ALIASES: [phrase: string, code: number][] = [
  // Aromatics, herbs, spices
  ["garlic", 2394], // Garlic, raw
  ["garlic powder", 188], // Spices, garlic powder
  ["onion", 2401], // Onion, raw
  ["sweet onion", 5414], // Onion, sweet, raw
  ["green onion", 2144], ["spring onion", 2144], ["scallion", 2144], // Onion, spring (green) or scallion, raw
  ["onion powder", 194], // Spices, onion powder
  ["ginger", 2091], ["fresh ginger", 2091], ["ginger root", 2091], // Ginger root, raw
  ["ground ginger", 189], ["ginger powder", 189], // Spices, ginger, ground
  ["salt", 214], ["sea salt", 214], ["kosher salt", 214], // Salt, table
  ["pepper", 198], ["black pepper", 198], // Spices, pepper, black
  ["cumin", 182], // Spices, cumin seed
  ["paprika", 196], ["smoked paprika", 196], // Spices, paprika
  ["chili powder", 177], ["chili flake", 177], ["red pepper flake", 177], ["chilli flake", 177], // Spices, chili powder
  ["curry powder", 183], // Spices, curry powder
  ["cinnamon", 178], // Spices, cinnamon, ground
  ["oregano", 195], // Spices, oregano, ground
  ["thyme", 210], // Spices, thyme, dried
  ["rosemary", 204], // Spices, rosemary, dried
  ["dill", 185], // Spices, dill weed, dried
  ["basil", 212], // Spices, basil, fresh
  ["mint", 4725], // Spices, spearmint, fresh
  ["parsley", 2405], // Parsley, fresh
  ["cilantro", 2067], ["coriander leaf", 2067], // Coriander (cilantro), raw
  ["vanilla", 216], ["vanilla extract", 216], // Vanilla extract
  ["baking powder", 4003], // Leavening agent, baking powder, double acting
  ["water", 2933], // Water, municipal

  // Oils, fats, dairy, eggs
  ["olive oil", 422], ["extra virgin olive oil", 422], // Vegetable oil, olive
  ["oil", 451], ["vegetable oil", 451], ["canola oil", 451], ["cooking oil", 451], // Vegetable oil, canola
  ["coconut oil", 420], // Vegetable oil, coconut
  ["sesame oil", 424], // Vegetable oil, sesame
  ["butter", 118], // Butter, regular
  ["egg", 125], ["eggs", 125], // Egg, chicken, whole, fresh or frozen, raw
  ["egg white", 126], // Egg, chicken, white, fresh or frozen, raw
  ["egg yolk", 127], // Egg, chicken, yolk, fresh or frozen, raw
  ["milk", 61], // Milk, fluid, partly skimmed, 2% M.F.
  ["whole milk", 113], // Milk, fluid, whole, 3.25% M.F.
  ["skim milk", 114], // Milk, fluid, skim, 0.1% M.F.
  ["almond milk", 7801], ["almond beverage", 7801], // Plant-based beverage, almond, unsweetened
  ["soy milk", 5241], ["soy beverage", 5241], // Plant-based beverage, soy, plain
  ["coconut milk", 2565], // Coconut milk, canned
  ["coconut cream", 2563], // Coconut cream, raw
  ["heavy cream", 138], ["whipping cream", 138], ["heavy whipping cream", 138], // Cream, whipping, 35% M.F.
  ["cream", 151], ["cooking cream", 151], // Cream, table (cooking), 15% M.F.
  ["half and half", 150], ["half & half", 150], // Cream, cereal (half and half), 10% M.F.
  ["sour cream", 139], // Cream, sour, cultured, 14% M.F
  ["yogurt", 6961], ["plain yogurt", 6961], // Yogourt, 2-3.9% M.F., plain
  ["greek yogurt", 7469], ["plain greek yogurt", 7469], // Yogourt, Greek style, 2% M.F., plain
  ["cottage cheese", 120], // Cheese, cottage, 2% M.F.
  ["cream cheese", 28], // Cheese, cream cheese product, plain
  ["cheese", 7737], ["cheddar", 7737], ["cheddar cheese", 7737], // Cheese, cheddar, medium
  ["mozzarella", 111], ["mozzarella cheese", 111], // Cheese, mozzarella, partly skimmed
  ["parmesan", 40], ["parmesan cheese", 40], ["parmigiano", 40], // Cheese, parmesan, hard
  ["feta", 108], ["feta cheese", 108], // Cheese, feta
  ["ricotta", 43], // Cheese, ricotta
  ["swiss cheese", 47], // Cheese, swiss (emmental)
  ["goat cheese", 98], // Cheese, goat, soft
  ["monterey jack", 34], // Cheese, monterey jack

  // Meat, poultry, fish
  ["chicken", 841], ["chicken breast", 841], // Chicken, broiler, breast, skinless, boneless, meat, raw
  ["chicken thigh", 853], // Chicken, broiler, thigh, meat, raw
  ["chicken drumstick", 847], ["drumstick", 847], // Chicken, broiler, drumstick, meat, raw
  ["chicken wing", 631], // Chicken, broiler, wing, meat, raw
  ["ground chicken", 918], // Chicken, ground, lean, raw
  ["cooked chicken", 842], ["rotisserie chicken", 842], ["shredded chicken", 842], ["leftover chicken", 842], // Chicken, broiler, breast, meat, roasted
  ["cooked chicken thigh", 854], // Chicken, broiler, thigh, meat, roasted
  ["ground turkey", 815], ["turkey mince", 815], // Turkey, all classes, ground, raw
  ["ground beef", 2690], ["beef mince", 2690], ["ground chuck", 2690], ["hamburger", 2690], // Beef, ground, medium, raw
  ["lean ground beef", 2683], // Beef, ground, lean, raw
  ["extra lean ground beef", 4996], // Beef, ground, extra lean, raw
  ["steak", 6143], ["sirloin", 6143], ["sirloin steak", 6143], ["beef", 6143], // Beef, top sirloin steak, lean, raw
  ["stewing beef", 6285], ["stew beef", 6285], // Beef, stewing beef, raw
  ["pork tenderloin", 1931], // Pork, loin, tenderloin, lean, raw
  ["pork", 1777], ["pork loin", 1777], ["pork chop", 1777], // Pork, loin, whole, lean, raw
  ["ground pork", 6121], ["pork mince", 6121], // Pork, ground, medium, raw
  ["bacon", 1936], // Pork, cured, bacon, raw
  ["italian sausage", 1152], ["sausage", 1152], // Sausage, Italian, pork, raw
  ["ham", 1862], // Ham, lean, canned
  ["ground lamb", 3639], // Lamb, Canadian, ground, raw
  ["salmon", 3182], ["salmon fillet", 3182], // Fish, salmon, atlantic, farmed, raw
  ["tuna", 3131], ["canned tuna", 3131], // Fish, tuna, light, canned in water, drained
  ["cod", 3194], // Fish, cod, Atlantic, raw
  ["tilapia", 5966], // Fish, tilapia, raw
  ["shrimp", 3211], ["prawn", 3211], // Crustaceans, shrimp, mixed species, raw

  // Grains, bread, pasta
  ["rice", 4471], ["white rice", 4471], ["jasmine rice", 4471], ["basmati rice", 4471], // Rice, white, long-grain, regular, dry
  ["brown rice", 4496], // Rice, brown, long-grain, dry
  ["cooked rice", 4523], ["cooked white rice", 4523], ["leftover rice", 4523], // Rice, white, long-grain, regular, cooked
  ["cooked brown rice", 4497], // Rice, brown, long-grain, cooked
  ["cooked quinoa", 5917], // Quinoa, cooked
  ["cooked pasta", 4480], ["cooked spaghetti", 4480], // Pasta, unenriched, cooked
  ["cooked lentil", 3393], // Lentils, mature seeds, boiled
  ["quinoa", 4495], // Quinoa, dry
  ["oat", 4421], ["rolled oat", 4421], ["oatmeal", 4421], // Grains, oats, dry
  ["flour", 4501], ["all purpose flour", 4501], ["all-purpose flour", 4501], // Wheat flour, white, all purpose
  ["whole wheat flour", 4500], // Wheat flour, whole wheat
  ["pasta", 4515], ["spaghetti", 4515], ["penne", 4515], ["macaroni", 4515], ["fusilli", 4515], ["rigatoni", 4515], ["orzo", 4515], // Pasta, enriched, dry
  ["whole wheat pasta", 4516], ["whole wheat spaghetti", 4516], // Pasta, whole wheat, dry
  ["egg noodle", 4512], // Pasta, egg noodles, enriched, dry
  ["rice noodle", 4888], // Pasta, rice noodles, dry
  ["couscous", 4420], // Couscous, dry
  ["bread", 4067], ["whole wheat bread", 4067], ["toast", 4067], // Bread, whole wheat, commercial
  ["bread crumb", 4069], ["breadcrumb", 4069], ["panko", 4069], // Bread crumbs, dry, plain
  ["tortilla", 4049], ["flour tortilla", 4049], ["wrap", 4049], // Tortilla, flour, plain
  ["corn tortilla", 4048], // Tortilla, corn, unsalted
  ["whole wheat tortilla", 7258], // Tortilla, whole grain
  ["pita", 3708], // Bread, pita, white
  ["bun", 3985], ["hamburger bun", 3985], ["burger bun", 3985], ["hot dog bun", 3985], // Roll, hamburger / hot dog, plain
  ["naan", 6606], // Indian, bread, naan
  ["cornstarch", 4419], ["corn starch", 4419], // Cornstarch
  ["cornmeal", 4470], // Cornmeal, yellow, degermed

  // Sweeteners, baking
  ["sugar", 4318], ["white sugar", 4318], ["granulated sugar", 4318], // Sugars, granulated (white)
  ["brown sugar", 4317], // Sugars, brown
  ["honey", 4294], // Honey, strained or extracted
  ["maple syrup", 4326], // Syrup, maple
  ["cocoa", 4223], ["cocoa powder", 4223], // Cocoa, powder, unsweetened
  ["chocolate chip", 4148], // Semisweet chocolate chips
  ["dark chocolate", 6673], // Candies, chocolate, dark, not further specified
  ["shredded coconut", 2559], ["coconut flake", 2559], ["desiccated coconut", 2559], // Coconut meat, desiccated, unsweetened

  // Legumes, nuts, seeds, plant proteins
  ["lentil", 3392], // Lentils, mature seeds, dry
  ["red lentil", 4869], // Lentils, pink, mature seeds, dry
  ["black bean", 3254], // Beans, black turtle, canned, solids and liquid
  ["kidney bean", 7081], // Beans, kidney, red, canned, drained solids
  ["white bean", 3266], ["cannellini bean", 3266], ["navy bean", 3266], // Beans, navy, canned
  ["almond flour", 2535], ["ground almond", 2535], // Almonds, dried, blanched (almond flour is ground blanched almonds)
  ["oat milk", 7808], ["oat beverage", 7808], // Plant-based beverage, oat and quinoa, unsweetened
  ["chickpea", 7060], ["garbanzo bean", 7060], // Chickpeas, canned, drained solids
  ["edamame", 6217], // Soybeans, green (edamame), frozen, unprepared
  ["tofu", 3404], ["firm tofu", 3404], ["extra firm tofu", 3404], // Tofu, regular, firm or extra firm
  ["hummus", 4870], // Hummus, commercial
  ["peanut butter", 3414], // Peanut butter, smooth type
  ["tahini", 2593], // Tahini, roasted kernels
  ["almond", 2534], // Almonds, dried, unblanched
  ["walnut", 2590], // Walnuts, English
  ["cashew", 5709], // Cashew nuts, raw
  ["pecan", 2582], // Pecans, dried
  ["pistachio", 2644], // Pistachio nuts, raw
  ["chia", 2511], ["chia seed", 2511], // Chia seeds, dried
  ["flax", 4528], ["flaxseed", 4528], ["ground flax", 4528], ["flax seed", 4528], // Flaxseed
  ["pumpkin seed", 2516], ["pepita", 2516], // Pumpkin seed kernels, dried
  ["sunflower seed", 2526], // Sunflower seed kernels, dried
  ["sesame seed", 2521], // Sesame seeds, whole, roasted
  ["protein powder", 7231], ["whey protein", 7229], // Protein powder, whey

  // Sauces, condiments, canned goods
  ["tomato", 2460], ["cherry tomato", 2460], ["roma tomato", 2460], // Tomato, red, ripe, raw
  ["canned tomato", 2462], ["diced tomato", 2462], ["whole tomato", 2462], // Tomato, canned, whole
  ["crushed tomato", 4736], // Tomato, canned, crushed
  ["tomato sauce", 2465], // Tomato products, canned, sauce
  ["tomato paste", 6579], // Tomato products, canned paste
  ["marinara", 4735], ["marinara sauce", 4735], ["pasta sauce", 4735], ["spaghetti sauce", 4735], // Sauce, pasta, ready-to-serve
  ["salsa", 1025], // Sauce, salsa
  ["ketchup", 2494], // Tomato ketchup
  ["mayonnaise", 531], ["mayo", 531], // Mayonnaise, regular
  ["soy sauce", 3403], // Soy sauce, shoyu, regular
  ["tamari", 3329], // Soy sauce, tamari
  ["teriyaki sauce", 997], ["teriyaki", 997],
  ["fish sauce", 4731],
  ["oyster sauce", 4730],
  ["hoisin", 4729], ["hoisin sauce", 4729],
  ["worcestershire", 1133], ["worcestershire sauce", 1133],
  ["sriracha", 7593],
  ["hot sauce", 1029],
  ["pesto", 7591],
  ["vinegar", 14], ["white vinegar", 14],
  ["apple cider vinegar", 13], ["cider vinegar", 13],
  ["balsamic", 6196], ["balsamic vinegar", 6196],
  ["red wine vinegar", 6195],
  ["broth", 6541], ["stock", 6541], ["chicken broth", 6541], ["chicken stock", 6541], // Soup, broth, chicken, ready-to-serve
  ["beef broth", 927], ["beef stock", 927],
  ["vegetable broth", 7374], ["vegetable stock", 7374],
  ["kimchi", 7599],
  ["olive", 1613], ["black olive", 1613], ["kalamata olive", 1613], // Olive, ripe, canned
  ["green olive", 5391], // Olive, pickled, green
  ["sun-dried tomato", 2349], ["sundried tomato", 2349], // Tomato, sun-dried, packed in oil, drained
  ["miso", 3319], ["miso paste", 3319], // Soybean, fermented products, miso
  ["mustard", 4970], ["yellow mustard", 4970], ["dijon", 4970], ["dijon mustard", 4970], // Sauce, mustard, yellow (closest CNF has to Dijon)
  ["bbq sauce", 1017], ["barbecue sauce", 1017], // Sauce, barbecue
  ["ranch", 5330], ["ranch dressing", 5330], // Salad dressing, ranch, regular
  ["taco seasoning", 6312], // Seasoning mix, taco, dry mix
  ["tortilla chip", 4127], // Snacks, tortilla chips, plain
  ["ice cream", 4163], // Ice cream, vanilla, 11% M.F.
  ["yeast", 4008], // Yeast, baker's, active, dry

  // Vegetables
  ["bell pepper", 2484], ["red bell pepper", 2484], ["red pepper", 2484], ["sweet pepper", 2484], // Pepper, sweet, red, raw
  ["green bell pepper", 2413], ["green pepper", 2413],
  ["yellow bell pepper", 2344], ["yellow pepper", 2344],
  ["jalapeno", 4860], ["jalapeño", 4860],
  ["chili pepper", 2322], ["chili", 2322], ["chile", 2322],
  ["spinach", 2213], ["baby spinach", 2213],
  ["kale", 2395],
  ["lettuce", 2116], ["romaine", 2116], ["romaine lettuce", 2116],
  ["arugula", 2352],
  ["cabbage", 2361], ["green cabbage", 2361], // Cabbage, raw
  ["red cabbage", 2034],
  ["broccoli", 2374],
  ["carrot", 2380],
  ["celery", 2386],
  ["cucumber", 2363],
  ["zucchini", 2225],
  ["mushroom", 2399],
  ["sweet potato", 2240],
  ["potato", 2505],
  ["corn", 2388],
  ["pea", 2409], ["green pea", 2409],
  ["frozen pea", 2151],
  ["green bean", 2370],
  ["asparagus", 1990],
  ["brussels sprout", 2378],
  ["butternut squash", 2451],
  ["eggplant", 2088],
  ["beet", 2500],
  ["leek", 2396],
  ["fennel", 2350],
  ["avocado", 1511],
  ["mixed vegetable", 2271],

  // Fruit
  ["lemon", 1587],
  ["lemon juice", 1589],
  ["lemon zest", 1592], ["lemon peel", 1592], // Lemon peel, raw
  ["lime", 1593],
  ["lime juice", 1594],
  ["banana", 1704],
  ["apple", 1696],
  ["blueberry", 1705],
  ["strawberry", 1749],
  ["raspberry", 1747],
  ["mango", 1603],
  ["pineapple", 1734],
  ["peach", 1728],
  ["pear", 7125],
  ["orange", 1617],
  ["date", 5401], ["medjool date", 5401],
  ["raisin", 1744],
  ["dried cranberry", 5390],
];
