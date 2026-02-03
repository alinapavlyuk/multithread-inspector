#include <thread>
#include <mutex>
#include <future>
#include <iostream>
#include <vector>
#include <atomic>
#include <condition_variable>
#include <memory>
#include <chrono>
#include <queue>

// Global variables for synchronization
std::mutex print_mutex;
std::mutex queue_mutex;
std::mutex data_mutex;
std::condition_variable cv_producer;
std::condition_variable cv_consumer;
std::atomic<int> task_counter{0};
std::atomic<bool> shutdown_flag{false};

// Shared data structures
std::shared_ptr<std::queue<int>> shared_queue = std::make_shared<std::queue<int>>();
std::shared_ptr<std::vector<int>> shared_results = std::make_shared<std::vector<int>>();

// Simple worker for cyclic thread creation
void cyclic_worker(int id, const std::string &type)
{
    std::unique_lock<std::mutex> lock(print_mutex);
    std::cout << "Cyclic worker [" << type << "] " << id << " started\n";
    lock.unlock();

    // Simulation of work
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    task_counter.fetch_add(1);
}

// Producer for condition_variable test
void producer_worker(int items_to_produce)
{
    for (int i = 0; i < items_to_produce; ++i)
    {
        {
            std::unique_lock<std::mutex> lock(queue_mutex);
            shared_queue->push(i * i);
            std::cout << "Produced: " << i * i << std::endl;
        }
        cv_producer.notify_one();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}

// Consumer for condition_variable test
void consumer_worker(int id)
{
    while (!shutdown_flag.load())
    {
        std::unique_lock<std::mutex> lock(queue_mutex);
        cv_producer.wait(lock, []
                         { return !shared_queue->empty() || shutdown_flag.load(); });

        if (!shared_queue->empty())
        {
            int value = shared_queue->front();
            shared_queue->pop();
            lock.unlock();

            // Processing data from shared_ptr
            {
                std::lock_guard<std::mutex> result_lock(data_mutex);
                shared_results->push_back(value * 2);
            }

            std::lock_guard<std::mutex> print_lock(print_mutex);
            std::cout << "Consumer " << id << " processed: " << value << std::endl;
        }
    }
}

// Function with atomic operations
void atomic_incrementer(int iterations)
{
    for (int i = 0; i < iterations; ++i)
    {
        task_counter.fetch_add(1, std::memory_order_relaxed);
        // Atomic compare and exchange test
        int expected = i;
        task_counter.compare_exchange_weak(expected, i + 1, std::memory_order_acquire);
    }
}

int main()
{
    std::cout << "=== ITERATION 2 TEST: IMPROVED THREAD ANALYSIS ===\n\n";

    // Variables for contextual analysis
    int thread_count = 5;
    bool enable_parallel_processing = true;
    std::string processing_mode = "intensive";

    std::vector<std::thread> all_threads;

    // 1. CONTEXTUAL ANALYSIS: Threads in loops
    std::cout << "1. Test of cyclic thread creation:\n";
    for (int i = 0; i < thread_count; ++i)
    {
        // Conditional thread creation depending on the index
        if (i % 2 == 0)
        {
            all_threads.emplace_back(cyclic_worker, i, "EVEN");
        }
        else
        {
            all_threads.emplace_back(cyclic_worker, i, "ODD");
        }
    }

    // 2. CONDITIONAL CREATION: Switch-based thread creation
    std::cout << "\n2. Test of conditional thread creation (switch):\n";
    for (int mode = 0; mode < 3; ++mode)
    {
        switch (mode)
        {
        case 0:
            if (enable_parallel_processing)
            {
                all_threads.emplace_back(atomic_incrementer, 100);
            }
            break;

        case 1:
            if (processing_mode == "intensive")
            {
                all_threads.emplace_back(producer_worker, 5);
            }
            break;

        case 2:
            // Multiple consumer creation
            for (int consumer_id = 0; consumer_id < 2; ++consumer_id)
            {
                all_threads.emplace_back(consumer_worker, consumer_id);
            }
            break;
        }
    }

    // 3. VARIABLES AFFECTING THREAD CREATION
    std::cout << "\n3. Test of dependency on variables:\n";
    std::cout << "thread_count = " << thread_count << std::endl;
    std::cout << "enable_parallel_processing = " << std::boolalpha << enable_parallel_processing << std::endl;
    std::cout << "processing_mode = " << processing_mode << std::endl;

    // 4. SYNCHRONIZATION: Different types of locks
    std::cout << "\n4. Test of synchronization primitives:\n";

    // std::async with different launch policies
    auto future_async = std::async(std::launch::async, []()
                                   {
        std::lock_guard<std::mutex> lock(print_mutex);
        std::cout << "Async task with std::launch::async\n";
        return 42; });

    auto future_deferred = std::async(std::launch::deferred, []()
                                      {
        std::unique_lock<std::mutex> lock(print_mutex);
        std::cout << "Deferred task executed\n";
        lock.unlock();
        return 24; });

    // 5. SHARED_PTR operations
    std::cout << "\n5. Test of shared_ptr operations:\n";
    std::shared_ptr<std::atomic<int>> shared_counter = std::make_shared<std::atomic<int>>(0);

    for (int i = 0; i < 3; ++i)
    {
        all_threads.emplace_back([shared_counter, i]()
                                 {
            for (int j = 0; j < 50; ++j)
            {
                shared_counter->fetch_add(1);
            }
            std::lock_guard<std::mutex> lock(print_mutex);
            std::cout << "Shared counter thread " << i << " finished\n"; });
    }

    // We wait a bit, then terminate the consumers
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    shutdown_flag.store(true);
    cv_producer.notify_all();

    // 6. WAITING FOR ALL THREADS TO FINISH
    std::cout << "\n6. Waiting for threads to finish...\n";
    for (auto &t : all_threads)
    {
        if (t.joinable())
        {
            t.join();
        }
    }

    // Getting the results of async operations
    std::cout << "\nResults of async operations:\n";
    std::cout << "Async result: " << future_async.get() << std::endl;
    std::cout << "Deferred result: " << future_deferred.get() << std::endl;

    // 7. FINAL STATISTICS
    std::cout << "\n=== FINAL STATISTICS ===\n";
    std::cout << "Task counter: " << task_counter.load() << std::endl;
    std::cout << "Shared counter: " << shared_counter->load() << std::endl;
    std::cout << "Processed results count: " << shared_results->size() << std::endl;
    std::cout << "Remaining queue items: " << shared_queue->size() << std::endl;

    // Output of processed results
    if (!shared_results->empty())
    {
        std::cout << "Processed values: ";
        for (const auto &val : *shared_results)
        {
            std::cout << val << " ";
        }
        std::cout << std::endl;
    }

    std::cout << "\n=== TEST FINISHED ===\n";
    return 0;
}
