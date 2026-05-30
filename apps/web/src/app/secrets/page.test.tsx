import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const mockDeleteSecret = vi.fn();
const mockListSecrets = vi.fn();
const mockCreateSecret = vi.fn();
const mockGetSecret = vi.fn();
const mockListRepos = vi.fn();

vi.mock("@/lib/api-client", () => ({
  api: {
    deleteSecret: (...args: any[]) => mockDeleteSecret(...args),
    listSecrets: (...args: any[]) => mockListSecrets(...args),
    createSecret: (...args: any[]) => mockCreateSecret(...args),
    getSecret: (...args: any[]) => mockGetSecret(...args),
    listRepos: (...args: any[]) => mockListRepos(...args),
  },
}));

vi.mock("@/hooks/use-dashboard-data", () => ({
  useDashboardData: vi.fn(() => ({ repos: [] })),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import SecretsPage from "./page";

describe("SecretsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSecrets.mockResolvedValue({
      secrets: [
        { id: "1", name: "MY_TEST_SECRET", scope: "global" },
      ],
    });
    mockListRepos.mockResolvedValue({ repos: [] });
    // Stub window.confirm
    vi.stubGlobal("confirm", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a list of secrets", async () => {
    render(<SecretsPage />);
    expect(await screen.findByText("MY_TEST_SECRET")).toBeInTheDocument();
  });

  it("deletes a secret only if confirmed", async () => {
    // 1. Setup mock confirm to return false
    vi.mocked(window.confirm).mockReturnValueOnce(false);

    render(<SecretsPage />);
    const deleteButton = await screen.findByTitle("Delete secret");

    // 2. Click delete and verify api is NOT called
    fireEvent.click(deleteButton);
    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete the secret "MY_TEST_SECRET"?');
    expect(mockDeleteSecret).not.toHaveBeenCalled();

    // 3. Setup mock confirm to return true
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    mockDeleteSecret.mockResolvedValueOnce(undefined);

    // 4. Click delete and verify api IS called
    fireEvent.click(deleteButton);
    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete the secret "MY_TEST_SECRET"?');

    await waitFor(() => {
        expect(mockDeleteSecret).toHaveBeenCalledWith("MY_TEST_SECRET", "global");
    });
  });
});
