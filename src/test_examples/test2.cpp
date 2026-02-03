// Test code for scenario 2: Analysis of code with compilation errors

#include <thread>
void task(
int main()
{
    std::thread t1(task);
    t1.join();
    return 0;
}
