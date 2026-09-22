export default function PaymentTerms() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <a
          href="/"
          className="inline-block mb-8 text-blue-600 hover:underline"
        >
          ← Вернуться в MetricTree
        </a>

        <h1 className="text-3xl font-bold mb-8">
          Оплата и условия использования
        </h1>

        <div className="space-y-8 text-sm leading-6">

          <section>
            <h2 className="text-xl font-semibold mb-3">
              О сервисе MetricTree
            </h2>
            <p>
              MetricTree — онлайн-сервис для создания и анализа деревьев
              продуктовых метрик с использованием технологий искусственного
              интеллекта.
            </p>
            <p className="mt-2">
              Сервис позволяет генерировать деревья метрик, получать анализ
              отдельных метрик, предложения новых метрик, проводить
              приоритизацию и формировать идеи A/B-экспериментов.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              MetricTree Pro
            </h2>

            <p>
              Стоимость доступа к MetricTree Pro составляет{" "}
              <strong>490 ₽ за 30 дней</strong>.
            </p>

            <p className="mt-2">
              В тариф Pro входит до 50 операций каждого типа в календарный
              месяц: генераций деревьев метрик, AI-разборов метрик, подсказок
              метрик, приоритизаций и генераций A/B-экспериментов.
            </p>

            <p className="mt-2">
              Оплата является разовой. Автоматического продления и
              автоматического списания денежных средств нет.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              Порядок оплаты и предоставления услуги
            </h2>

            <p>
              Оплата производится онлайн через платёжный сервис Robokassa.
              После подтверждения успешной оплаты доступ MetricTree Pro
              активируется для аккаунта пользователя на 30 дней.
            </p>

            <p className="mt-2">
              Услуга считается предоставляемой с момента активации доступа
              MetricTree Pro в аккаунте пользователя.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              Доставка
            </h2>
            <p>
              MetricTree является цифровым сервисом. Физическая доставка
              товаров не осуществляется. Доступ к платным функциям
              предоставляется в электронном виде на сайте metrictree.ru.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              Возврат денежных средств
            </h2>

            <p>
              Для обращения по вопросу возврата денежных средств пользователь
              может связаться с нами по электронной почте, указанной ниже.
              Возможность и размер возврата определяются с учётом фактически
              оказанной части услуги и требований применимого законодательства.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              Исполнитель
            </h2>

            <p>Индивидуальный предприниматель Павлов Владимир Владимирович</p>
            <p>ИНН: 781005734060</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              Контактная информация
            </h2>

            <p>E-mail: vladimir.pavlov@yashaservice.ru</p>
            <p>Сайт: metrictree.ru</p>
          </section>

        </div>
      </div>
    </div>
  );
}