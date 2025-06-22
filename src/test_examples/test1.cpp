// Тестовий код сценарію 1: Аналіз коду з декларацією потоку та без помилок компіляції

#include <thread>
void task() {}
int main()
{
    std::thread t1(task);
    std::thread t2(task);
    std::thread t3(task);
    std::thread t4(task);
    std::thread t5(task);
    std::thread t6(task);
    t1.join();
    t1.join();
    return 0;
}