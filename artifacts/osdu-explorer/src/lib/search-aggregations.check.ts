import assert from "node:assert/strict";
import {
  parseAggregationResponse,
  sortBuckets,
  aggregationTotal,
  collapseBuckets,
  shortKind,
} from "./search-aggregations";

// parseAggregationResponse: reads buckets, sorts by count desc, drops junk.
const parsed = parseAggregationResponse({
  totalCount: 130,
  aggregations: [
    { key: "osdu:wks:master-data--Wellbore:1.0.0", count: 23 },
    { key: "osdu:wks:master-data--Well:1.0.0", count: 100 },
    { key: "bad-bucket" },              // no count → dropped
    { count: 5 },                        // no key → dropped
    { key: "osdu:wks:dataset--File.Generic:1.0.0", count: 7 },
  ],
});
assert.deepEqual(parsed, [
  { key: "osdu:wks:master-data--Well:1.0.0", count: 100 },
  { key: "osdu:wks:master-data--Wellbore:1.0.0", count: 23 },
  { key: "osdu:wks:dataset--File.Generic:1.0.0", count: 7 },
]);

// Missing / malformed aggregations → empty.
assert.deepEqual(parseAggregationResponse({}), []);
assert.deepEqual(parseAggregationResponse({ aggregations: null }), []);
assert.deepEqual(parseAggregationResponse(null), []);
assert.deepEqual(parseAggregationResponse({ aggregations: "nope" }), []);

// sortBuckets: ties broken alphabetically, input not mutated.
const input = [
  { key: "b", count: 5 },
  { key: "a", count: 5 },
  { key: "c", count: 9 },
];
assert.deepEqual(sortBuckets(input), [
  { key: "c", count: 9 },
  { key: "a", count: 5 },
  { key: "b", count: 5 },
]);
assert.equal(input[0].key, "b", "sortBuckets must not mutate its input");

// aggregationTotal.
assert.equal(aggregationTotal(parsed), 130);
assert.equal(aggregationTotal([]), 0);

// collapseBuckets: keeps top n, rolls the tail into Other.
const many = [
  { key: "a", count: 50 },
  { key: "b", count: 30 },
  { key: "c", count: 12 },
  { key: "d", count: 5 },
  { key: "e", count: 3 },
];
const collapsed = collapseBuckets(many, 3);
assert.deepEqual(collapsed.top, [
  { key: "a", count: 50 },
  { key: "b", count: 30 },
  { key: "c", count: 12 },
]);
assert.equal(collapsed.otherCount, 8);
assert.equal(collapsed.otherKinds, 2);

// collapseBuckets: nothing to collapse when within n.
const small = collapseBuckets(many.slice(0, 2), 3);
assert.equal(small.otherCount, 0);
assert.equal(small.otherKinds, 0);
assert.equal(small.top.length, 2);

// shortKind: entity name after "--", else segment after last ":".
assert.equal(shortKind("osdu:wks:master-data--Well:1.0.0"), "Well");
assert.equal(shortKind("osdu:wks:dataset--File.Generic:1.0.0"), "File.Generic");
assert.equal(shortKind("osdu:wks:AbstractFacility:1.0.0"), "1.0.0");
assert.equal(shortKind("no-colons"), "no-colons");

console.log("search-aggregations check passed.");
