# multithread-inspector

**Multithread Inspector** is an extension for static analysis and visualization of thread usage and synchronization in C++ code. It helps you understand, debug, and document multithreaded logic by providing interactive thread flow graphs and detailed reports.

## Features

- **Thread Flow Graph Visualization:**  
  Generates an interactive graph showing thread creation, synchronization primitives, and their relationships in your C++ code.

- **Context Analysis:**  
  Highlights threads created inside loops and conditionals for easier detection of potential concurrency issues.

- **Synchronization Mapping:**  
  Visualizes usage of mutexes, atomics, condition variables, and other synchronization primitives.

- **Clickable Navigation:**  
  Click on graph nodes to jump directly to relevant lines in your source code.

- **Textual Reports:**  
  Provides a summary and detailed report of thread and synchronization usage.

## Getting Started

1. **Install the extension** from the VSCode Marketplace.
2. **Open a C++ file** with threading code.
3. **Run the analysis**:
   - Press <kbd>Ctrl+Shift+T</kbd> (Windows/Linux) or <kbd>Cmd+Shift+T</kbd> (macOS).
   - Or right-click in the editor and select **Analyze Thread Flow**.
4. **View the results** in the "C++ Thread Flow Graph" panel.

## Supported Threading Constructs

- `std::thread`
- `std::async`
- `pthread_create`
- `std::mutex`, `std::lock_guard`, `std::unique_lock`
- `std::condition_variable`
- `std::atomic`
- `std::shared_ptr` (for shared data)
- Basic detection of thread creation in loops and conditionals

## Requirements

- Visual Studio Code 1.70.0 or newer
- Works on Windows, Linux, and macOS
- No external dependencies required

## Extension Settings

_No custom settings yet. All features work out-of-the-box._

## Known Issues

- Analysis is static and may not detect all dynamic/threading patterns.
- Complex macro-generated or template-based threading code may not be fully supported.
- Only basic context analysis for loops and conditionals.

## Release Notes

### 1.0.0

- Initial release: thread flow graph, context analysis, clickable navigation, and textual reports.

---

**Enjoy using multithread-inspector!**  
Feel free to open issues or contribute improvements.

---
