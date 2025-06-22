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

// Глобальні змінні для синхронізації
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

// Простий воркер для циклічного створення потоків
void cyclic_worker(int id, const std::string &type)
{
    std::unique_lock<std::mutex> lock(print_mutex);
    std::cout << "Cyclic worker [" << type << "] " << id << " started\n";
    lock.unlock();

    // Симуляція роботи
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    task_counter.fetch_add(1);
}

// Producer для condition_variable тесту
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

// Consumer для condition_variable тесту
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

            // Обробка даних зі shared_ptr
            {
                std::lock_guard<std::mutex> result_lock(data_mutex);
                shared_results->push_back(value * 2);
            }

            std::lock_guard<std::mutex> print_lock(print_mutex);
            std::cout << "Consumer " << id << " processed: " << value << std::endl;
        }
    }
}

// Функція з atomic операціями
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
    std::cout << "=== ТЕСТ ІТЕРАЦІЇ 2: ПОКРАЩЕНИЙ АНАЛІЗ ПОТОКІВ ===\n\n";

    // Змінні для контекстного аналізу
    int thread_count = 5;
    bool enable_parallel_processing = true;
    std::string processing_mode = "intensive";

    std::vector<std::thread> all_threads;

    // 1. КОНТЕКСТНИЙ АНАЛІЗ: Потоки у циклах
    std::cout << "1. Тест циклічного створення потоків:\n";
    for (int i = 0; i < thread_count; ++i)
    {
        // Умовне створення потоків залежно від індексу
        if (i % 2 == 0)
        {
            all_threads.emplace_back(cyclic_worker, i, "EVEN");
        }
        else
        {
            all_threads.emplace_back(cyclic_worker, i, "ODD");
        }
    }

    // 2. УМОВНЕ СТВОРЕННЯ: Switch-based thread creation
    std::cout << "\n2. Тест умовного створення потоків (switch):\n";
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
            // Множинне створення споживачів
            for (int consumer_id = 0; consumer_id < 2; ++consumer_id)
            {
                all_threads.emplace_back(consumer_worker, consumer_id);
            }
            break;
        }
    }

    // 3. ЗМІННІ, ЩО ВПЛИВАЮТЬ НА СТВОРЕННЯ ПОТОКІВ
    std::cout << "\n3. Тест залежності від змінних:\n";
    std::cout << "thread_count = " << thread_count << std::endl;
    std::cout << "enable_parallel_processing = " << std::boolalpha << enable_parallel_processing << std::endl;
    std::cout << "processing_mode = " << processing_mode << std::endl;

    // 4. СИНХРОНІЗАЦІЯ: Різні типи блокувань
    std::cout << "\n4. Тест синхронізаційних примітивів:\n";

    // std::async з різними launch policies
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

    // 5. SHARED_PTR операції
    std::cout << "\n5. Тест shared_ptr операцій:\n";
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

    // Чекаємо трохи, потім завершуємо споживачів
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    shutdown_flag.store(true);
    cv_producer.notify_all();

    // 6. ОЧІКУВАННЯ ЗАВЕРШЕННЯ ВСІХ ПОТОКІВ
    std::cout << "\n6. Очікування завершення потоків...\n";
    for (auto &t : all_threads)
    {
        if (t.joinable())
        {
            t.join();
        }
    }

    // Отримання результатів async операцій
    std::cout << "\nРезультати async операцій:\n";
    std::cout << "Async result: " << future_async.get() << std::endl;
    std::cout << "Deferred result: " << future_deferred.get() << std::endl;

    // 7. ФІНАЛЬНА СТАТИСТИКА
    std::cout << "\n=== ФІНАЛЬНА СТАТИСТИКА ===\n";
    std::cout << "Task counter: " << task_counter.load() << std::endl;
    std::cout << "Shared counter: " << shared_counter->load() << std::endl;
    std::cout << "Processed results count: " << shared_results->size() << std::endl;
    std::cout << "Remaining queue items: " << shared_queue->size() << std::endl;

    // Виведення оброблених результатів
    if (!shared_results->empty())
    {
        std::cout << "Processed values: ";
        for (const auto &val : *shared_results)
        {
            std::cout << val << " ";
        }
        std::cout << std::endl;
    }

    std::cout << "\n=== ТЕСТ ЗАВЕРШЕНО ===\n";
    return 0;
}