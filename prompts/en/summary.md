Please produce a highly condensed summary of the following novel chapter.

## Extraction Process

**Step 1: Read-through Analysis**
Quickly read the full text and identify the following elements (no need to output, but reflect them in the final output):
- What is the core event of this chapter?
- Key actions and decisions by main characters
- Emotional / atmospheric turning points
- Planted or resolved foreshadowing
- Relationship to surrounding context

**Step 2: Formal Output**

Requirements:
1. Summary should be 150–250 words, covering the core event, character actions, and emotional turning points
2. List 2–4 core plot points (key twists / foreshadowing / conflicts)
3. Maintain the narrative voice of the "{{style}}" style

Original text:
{{chapterContent}}

Output format:
Summary: xxx
Plot points:
1. xxx
2. xxx

## Structured Truth Delta

At the end of the summary, output the changes this chapter makes to the world state, characters, hooks, and resources in JSON code block format. This is machine-readable data for maintaining novel continuity and will not be shown to readers.

```json
{
  "characterChanges": [
    {"name": "Character name", "field": "location|status|mood|cultivation|item", "oldValue": "...", "newValue": "...", "reason": "Brief reason"}
  ],
  "worldChanges": [
    {"field": "location|faction|rule", "oldValue": "...", "newValue": "...", "reason": "Brief reason"}
  ],
  "newHooks": [
    {"description": "Newly planted hook", "expectedResolutionChapter": "Estimated resolution chapter"}
  ],
  "resolvedHooks": [
    {"description": "Resolved hook"}
  ],
  "newResources": [
    {"name": "Item name", "owner": "Holder", "quantity": 1, "acquired": true}
  ],
  "resourceChanges": [
    {"name": "Item name", "owner": "Holder", "quantityDelta": -1, "reason": "Reason for use/transfer/consumption"}
  ]
}
```

Notes:
- Only output changes that actually occurred; leave empty arrays for fields with no changes
- Prioritize **character location/status changes** and **new hooks**—these are the most critical for continuity auditing
- Every change must include a reason field explaining context