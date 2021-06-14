class appIndexStringClass:
    @staticmethod
    def getAppIndexString():
        # the index string adds information to the html code like meta-tags, google-analytics or scripts.
        # the brackets{%xxx%} merge the content generated at another place to the defined html
        index_string = '''
        <!DOCTYPE html>
        <html>
            <head> 
                <script>
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  
                  gtag('config', 'UA-194128823-1');
                </script>
                {%metas%}
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta property="og:image" content="https://fiat2defi.ch/assets/img/defipromo_logos/logo_defichange-2.png">
                <meta name="description" content="Decentral Finance Exchange! Buy each DeFi Asset with EUR, CHF or USD immediately via bank transfer!">
                <title>Decentral Finance Exchange</title>
                <meta name="twitter:card" content="summary_large_image">
                <meta name="twitter:title" content="DeFiChain Exchange API">
                <meta name="twitter:description" content="Decentral Finance Exchange! Buy each DeFi Asset with EUR, CHF or USD immediately via bank transfer!">
                <meta name="twitter:image" content="https://fiat2defi.ch/assets/img/defipromo_logos/logo_defichange-2.png">
                {%favicon%}
                {%css%}
            </head>
            <body>
                {%app_entry%}
                <footer>
                    {%config%}
                    {%scripts%}
                    {%renderer%}
                </footer>
            </body>
        </html>
        '''
        return index_string