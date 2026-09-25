# Tornado Strength Lab

An interactive model of tornado strength on the Enhanced Fujita (EF) scale. Pick a strength from EF0 to EF5, pick an object, and send the tornado to see what happens.

Objects: car, semi truck, school bus, freight train, small plane, boat, cow, house, mobile home, barn, tree, highway bridge, and 3-, 7-, 15- and 30-story buildings.

## Run it

It's plain HTML, CSS and JavaScript with no build step. Open `index.html` through any static server:

```bash
python -m http.server 8123
```

Then go to http://localhost:8123.

## Note

This is a simplified model for learning. Damage descriptions are based on the Enhanced Fujita scale damage indicators used by the U.S. National Weather Service. Real damage depends on construction, how long the wind lasts, and flying debris.
