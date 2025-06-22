#include <chrono>
#include <iostream>
#include <string>
#include <thread>

using std::size_t;
using std::chrono::duration_cast;
using std::chrono::high_resolution_clock;
using std::chrono::nanoseconds;

int **create_matrix(size_t n)
{
    int **matrix = new int *[n];
    for (size_t i = 0; i < n; ++i)
        matrix[i] = new int[n];

    return matrix;
}

void delete_matrix(int **m, size_t n)
{
    for (size_t i = 0; i < n; ++i)
        delete[] m[i];
    delete[] m;
}

void fill_matrix(int **matrix, size_t n)
{
    for (size_t i = 0; i < n; ++i)
        for (size_t j = 0; j < n; ++j)
            matrix[i][j] = std::rand() % 1000;
}

void process_matrix_parallel(int **matrix, size_t n, size_t from, size_t to)
{
    for (size_t i = from; i <= to; ++i)
    {
        if (i >= n)
            return;

        size_t sum = 0;
        for (size_t j = 0; j < n; ++j)
            sum += matrix[i][j];
        matrix[0][0] = sum;
    }
}

void print_matrix(int **matrix, size_t n)
{
    for (size_t i = 0; i < n; ++i)
    {
        for (size_t j = 0; j < n; ++j)
            std::cout << matrix[i][j] << '\t';
        std::cout << std::endl;
    }
}

int main(int argc, char **argv)
{
    if (!(argc == 3 || argc == 4))
    {
        std::cout << "Usage: ./lab1_parallel <dimension N of square matrix> "
                     "<number of threads> <'p' to print result>\n";
        return -1;
    }
    const size_t n = std::atoll(argv[1]);
    const size_t t = std::atoll(argv[2]);
    const bool print = argc == 4 && argv[3][0] == 'p';

    int **matrix = create_matrix(n);
    fill_matrix(matrix, n);

    std::thread *threads = new std::thread[t];
    const size_t rows_each = n / t;
    const size_t rows_rem = n % t;

    auto begin = high_resolution_clock::now();

    for (size_t i = 0, j = 0; i < t; ++i)
    {
        size_t from = i * rows_each + j;
        if (j < rows_rem)
            ++j;
        size_t to = (i + 1) * rows_each + j;
        threads[i] = std::thread(process_matrix_parallel, matrix, n, from, to);
    }

    for (size_t i = 0; i < t; ++i)
        threads[i].join();

    auto end = high_resolution_clock::now();
    auto elapsed = duration_cast<nanoseconds>(end - begin);
    std::printf("Processing Time: %.3f milliseconds.\n", elapsed.count() * 1e-6);

    delete[] threads;

    if (print)
        print_matrix(matrix, n);
    delete_matrix(matrix, n);

    return 0;
}