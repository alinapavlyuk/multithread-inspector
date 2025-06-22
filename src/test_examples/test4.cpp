#include <thread>
#include <vector>
void worker(int id)
{
}

int main()
{
    std::thread t1(worker, 1);
    std::thread t2(worker, 2);

    std::vector<std::thread> threads;
    for (int i = 0; i < 3; ++i)
    {
        threads.emplace_back(worker, i + 3);
    }

    if (true)
    {
        std::thread t6(worker, 6);
        t6.join();
    }

    t1.join();
    t2.join();
    for (auto &t : threads)
    {
        t.join();
    }

    return 0;
}
