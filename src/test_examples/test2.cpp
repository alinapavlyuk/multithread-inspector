// Тестовий код сценарію 2: Аналіз коду з помилками компіляції

#include <thread>
void task(
int main()
{
    std::thread t1(task);
    t1.join();
    return 0;
}