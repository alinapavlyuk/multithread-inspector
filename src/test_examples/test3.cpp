// Тестовий код сценарію 3: Аналіз коду з примітивами синхронізації

#include <thread>
#include <mutex>
std::mutex mtx;

void task()
{
    std::lock_guard<std::mutex> lock(mtx);
}

int main()
{
    std::thread t1(task);
    t1.join();
    return 0;
}