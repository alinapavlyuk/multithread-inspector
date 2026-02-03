#include <thread>
#include <mutex>
#include <future>
#include <iostream>
#include <vector>
#include <atomic>
#include <condition_variable>

// Global syncronization variables
std::mutex print_mutex;
std::mutex data_mutex;
std::condition_variable cv;
std::atomic<int> counter{0};
bool ready = false;

// Simple worker function
void simple_worker(int id)
{
    std::lock_guard<std::mutex> lock(print_mutex);
    std::cout << "Simple worker " << id << " is running\n";
}

// Function with condition_variable
void waiting_worker(int id)
{
    std::unique_lock<std::mutex> lock(data_mutex);
    cv.wait(lock, []
            { return ready; });

    std::lock_guard<std::mutex> print_lock(print_mutex);
    std::cout << "Waiting worker " << id << " finished waiting\n";
}

// Function for std::async
int async_calculation(int value)
{
    counter.fetch_add(1);
    return value * value;
}

// Function with atomic operations
void atomic_worker()
{
    for (int i = 0; i < 1000; ++i)
    {
        counter.fetch_add(1);
    }
}

int main()
{
    std::cout << "Starting thread analysis example\n";

    // 1. Initialization of simple_worker threads
    std::thread t1(simple_worker, 1);
    std::thread t2(simple_worker, 2);

    // 2. Threads with condition_variable
    std::thread t3(waiting_worker, 3);
    std::thread t4(waiting_worker, 4);

    // 3. std::async examples
    auto future1 = std::async(std::launch::async, async_calculation, 10);
    auto future2 = std::async(std::launch::deferred, async_calculation, 20);

    // 4. Threads with atomic operations
    std::vector<std::thread> atomic_threads;
    for (int i = 0; i < 3; ++i)
    {
        atomic_threads.emplace_back(atomic_worker);
    }

    // Sleep for 100 milliseconds, then wake up waiting workers
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    {
        std::lock_guard<std::mutex> lock(data_mutex);
        ready = true;
    }
    cv.notify_all();

    // Waiting for all threads to finish their execution
    t1.join();
    t2.join();
    t3.join();
    t4.join();

    for (auto &t : atomic_threads)
    {
        t.join();
    }

    // Receiving async operations result
    std::cout << "Async result 1: " << future1.get() << std::endl;
    std::cout << "Async result 2: " << future2.get() << std::endl;

    std::cout << "Final counter value: " << counter.load() << std::endl;
    std::cout << "All threads completed\n";

    return 0;
}
