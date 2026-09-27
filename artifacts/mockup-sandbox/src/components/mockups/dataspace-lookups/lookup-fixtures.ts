export function getListOsduLegalTagsQueryKey(params: { valid: boolean }) {
  return ["mock-legal-tags", params];
}

export function useListOsduLegalTags(_params: { valid: boolean }, _options?: unknown) {
  return {
    data: {
      legalTags: [
        { name: "demo-public-data", description: "Publicly available subsurface data" },
        { name: "osdu-demo-project", description: "Demo project data access" },
        { name: "regional-survey-2024", description: "Regional survey collection" },
        { name: "sample-well-logs", description: "Sample well logs and measurements" },
        { name: "test-data-partition", description: "Test-only partition data" },
        { name: "partner-shared", description: "Shared with approved partners" },
      ],
    },
    isError: false,
    isLoading: false,
  };
}