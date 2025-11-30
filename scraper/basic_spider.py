import scrapy

class BasicSpider(scrapy.Spider):
    name = "basic_test"

    start_urls = ["https://example.com"]

    def parse(self, response):
        yield {
            "title": response.css("h1::text").get(),
            "url": response.url
        }
