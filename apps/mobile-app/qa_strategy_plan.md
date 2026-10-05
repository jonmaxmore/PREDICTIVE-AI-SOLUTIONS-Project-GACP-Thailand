# Apple "Automated Stress Test Lab" - Strategy Plan
**Objective:** Randomized Integration Test (Fuzzing) for GACP Flutter App.

## Philosophy
"Chaos Engineering for Mobile UI". We don't just follow happy paths; we actively try to trip the app up by simulating hostile user environments and behaviors.

## Core Component: `fuzz_stress_test.dart`
This integration test will act as a harness for our "Chaos Squads".
- **Harness:** Wraps existing `ApplicationFormScreen` (or Main App) in a `ProviderScope` with Mock Repositories.
- **Random Seed:** Uses `Random()` to ensure unpredictability but logs the seed for reproducibility.
- **The Loop:** Executes 1000 "Mini-Sessions" (iterations).

## The Chaos Squads (Implementation Details)

### 1. Speed Runners (The Tappers)
- **Goal:** Race conditions, unmounted widget access.
- **Action:** 
  - Find all `InkWell`, `ElevatedButton`, `TextButton`.
  - Pick a random subset (e.g., 5 buttons).
  - Tap them in rapid succession with minimal `pump()` duration (e.g., 50ms).
  - Rapidly scroll up and down.

### 2. Network Ghosts (The Disconnected)
- **Goal:** Error handling, visual feedback for failures.
- **Action:**
  - Temporarily swap Mock Repository behaviors to throw `SocketException` or return 500 Errors.
  - Attempt a form submission or critical action.
  - Verify if "Error" SnackBar appears.
  - **Simulate Connectivity Change:** If `OfflineService` is accessible, mock its Stream/Status to 'none'.

### 3. Input Spammers (The Fuzzers)
- **Goal:** Validation crashes, overflow errors, injection vulnerability.
- **Action:**
  - Find all `TextField` widgets.
  - Inject payloads:
    - **Mega-String:** 10k chars.
    - **SQL Injection:** `' OR 1=1 --`.
    - **Emojis:** 🌴🚑🍄.
    - **Negative/OOB Numbers:** `-999999999`.
  - Trigger "Unfocus" to run field validation logic.

### 4. Deep Navigators (The Multitaskers)
- **Goal:** State preservation, OOM (Out of Memory).
- **Action:**
  - Push a new Route (if navigation is available) -> Pop.
  - **Lifecycle Torture:** 
    - `AppLifecycleState.paused` (Background).
    - Wait random delays.
    - `AppLifecycleState.resumed` (Foreground).
  - Verify state (e.g., Form text) is still there.

## Execution
Run with: `flutter test test/widget/fuzz_stress_test.dart`
